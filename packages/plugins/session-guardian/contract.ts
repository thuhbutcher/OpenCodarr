export type SessionContract = Readonly<{
  sessionID: string
  revision: number
  objective: string
  phase: string
  exclusions: readonly string[]
  checkpoint?: string
  state: "ACTIVE" | "PAUSED" | "BLOCKED" | "UNKNOWN_OUTCOME"
}>

type SessionEvent = {
  readonly sessionID: string
  system: Array<{ type: "text"; text: string }>
}

const states = new Set(["ACTIVE", "PAUSED", "BLOCKED", "UNKNOWN_OUTCOME"])
const fields = new Set(["sessionID", "revision", "objective", "phase", "exclusions", "checkpoint", "state"])
const marker = "<opencodarr-session-contract>"

/** Decode only explicitly configured, non-secret task guidance; absent options leave the plugin inert. */
export function configuredContract(options: unknown): SessionContract | undefined {
  if (!isRecord(options)) throw new Error("SESSION_CONTRACT_INVALID_OPTIONS")
  if (Object.keys(options).some((key) => key !== "contract")) throw new Error("SESSION_CONTRACT_UNKNOWN_OPTION")
  if (options.contract === undefined) return undefined
  const input = options.contract
  if (!isRecord(input) || Object.keys(input).some((key) => !fields.has(key)))
    throw new Error("SESSION_CONTRACT_INVALID_FIELDS")
  if (!validText(input.sessionID, 256) || /[\s\u0000-\u001f\u007f]/u.test(input.sessionID))
    throw new Error("SESSION_CONTRACT_INVALID_SESSION")
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1)
    throw new Error("SESSION_CONTRACT_INVALID_REVISION")
  if (!validText(input.objective, 2000) || !validText(input.phase, 160))
    throw new Error("SESSION_CONTRACT_INVALID_PURPOSE")
  if (!Array.isArray(input.exclusions) || input.exclusions.length > 20 || input.exclusions.some((x) => !validText(x, 512)))
    throw new Error("SESSION_CONTRACT_INVALID_EXCLUSIONS")
  if (input.checkpoint !== undefined && !validText(input.checkpoint, 1500))
    throw new Error("SESSION_CONTRACT_INVALID_CHECKPOINT")
  if (typeof input.state !== "string" || !states.has(input.state)) throw new Error("SESSION_CONTRACT_INVALID_STATE")
  const contract: SessionContract = Object.freeze({
    sessionID: input.sessionID,
    revision: input.revision as number,
    objective: input.objective,
    phase: input.phase,
    exclusions: Object.freeze([...input.exclusions]) as readonly string[],
    ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint as string }),
    state: input.state as SessionContract["state"],
  })
  if (new TextEncoder().encode(renderGuidance(contract)).byteLength > 8192) throw new Error("SESSION_CONTRACT_TOO_LARGE")
  return contract
}

/** Add the configured guidance once to the selected session's request. */
export function projectContract(event: SessionEvent, contract: SessionContract): void {
  if (event.sessionID !== contract.sessionID) return
  const text = renderGuidance(contract)
  if (!event.system.some((part) => part.type === "text" && part.text === text)) event.system.push({ type: "text", text })
}

function renderGuidance(contract: SessionContract): string {
  const { sessionID: _sessionID, ...guidance } = contract
  const json = JSON.stringify(guidance).replace(/[<>&]/g, (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`)
  return [
    marker,
    "Operator-configured task guidance follows. It does not grant permission, establish completion, or authorize continuation.",
    json,
    "</opencodarr-session-contract>",
  ].join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value)
}

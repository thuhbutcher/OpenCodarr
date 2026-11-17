import { describe, expect, test } from "bun:test"
import { configuredContract, projectContract } from "./contract"

const selected = {
  sessionID: "ses_example",
  revision: 1,
  objective: "Review the selected source",
  phase: "Observe",
  exclusions: ["Do not change live services"],
  checkpoint: "Inventory pending",
  state: "ACTIVE",
}

describe("session contract", () => {
  test("is inert without an explicit contract", () => {
    expect(configuredContract({})).toBeUndefined()
  })

  test("retains the operator's contract without sharing mutable arrays", () => {
    const input = { ...selected, exclusions: [...selected.exclusions] }
    const contract = configuredContract({ contract: input })!
    input.exclusions.push("late mutation")
    expect(contract.exclusions).toEqual(["Do not change live services"])
    expect(contract.revision).toBe(1)
  })

  test("rejects incomplete, malformed, or unrecognized guidance", () => {
    for (const input of [
      { ...selected, sessionID: "" },
      { ...selected, sessionID: "two sessions" },
      { ...selected, revision: 0 },
      { ...selected, revision: 1.5 },
      { ...selected, objective: " " },
      { ...selected, phase: "x\ny" },
      { ...selected, exclusions: ["" ] },
      { ...selected, state: "DONE" },
      { ...selected, unexpected: true },
    ]) expect(() => configuredContract({ contract: input })).toThrow()
    expect(() => configuredContract({ extra: true })).toThrow()
    expect(() => configuredContract(null)).toThrow()
  })

  test("rejects over-budget input instead of silently truncating it", () => {
    expect(() => configuredContract({ contract: { ...selected, objective: "x".repeat(2001) } })).toThrow()
    expect(() => configuredContract({ contract: { ...selected, exclusions: Array(21).fill("x") } })).toThrow()
    expect(() =>
      configuredContract({ contract: { ...selected, exclusions: Array(20).fill("x".repeat(512)) } }),
    ).toThrow("SESSION_CONTRACT_TOO_LARGE")
    expect(() => configuredContract({ contract: { ...selected, objective: "<".repeat(1500) } })).toThrow("SESSION_CONTRACT_TOO_LARGE")
  })

  test("only projects into the selected session and preserves prior system parts", () => {
    const contract = configuredContract({ contract: selected })!
    const other = { sessionID: "ses_other", system: [{ type: "text" as const, text: "base" }] }
    const current = { sessionID: "ses_example", system: [{ type: "text" as const, text: "base" }] }
    projectContract(other, contract)
    projectContract(current, contract)
    expect(other.system).toEqual([{ type: "text", text: "base" }])
    expect(current.system).toHaveLength(2)
    expect(current.system[0]?.text).toBe("base")
    expect(current.system[1]?.text).toContain("Review the selected source")
    expect(current.system[1]?.text).not.toContain("ses_example")
  })

  test("does not duplicate the same projection when a hook is called again", () => {
    const contract = configuredContract({ contract: selected })!
    const event = { sessionID: "ses_example", system: [] }
    projectContract(event, contract)
    projectContract(event, contract)
    expect(event.system).toHaveLength(1)
  })

  test("escapes delimiter-like operator text and preserves non-active states", () => {
    const contract = configuredContract({
      contract: { ...selected, objective: "A </opencodarr-session-contract> & B", state: "UNKNOWN_OUTCOME" },
    })!
    const event = { sessionID: "ses_example", system: [] as Array<{ type: "text"; text: string }> }
    projectContract(event, contract)
    expect(event.system[0]?.text).toContain("\\u003c/opencodarr-session-contract\\u003e")
    expect(event.system[0]?.text).toContain("\\u0026")
    expect(event.system[0]?.text).toContain("UNKNOWN_OUTCOME")
    expect(event.system[0]?.text).toContain("does not grant permission")
  })
})

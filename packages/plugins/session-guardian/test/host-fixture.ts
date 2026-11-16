import { LLMClient, type LLMRequest } from "@opencode/ai/effect"
import { TestLLM } from "@opencode/ai/testing"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Plugin } from "@opencode/plugin"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { OpenCode } from "@opencode/sdk/effect"
import { Effect, Layer } from "effect"
import { fileURLToPath } from "node:url"
import { createSessionGuardian } from "../index"

const directory = process.env.OPENCODARR_TEST_WORKSPACE
if (!directory) throw new Error("ISOLATED_TEST_WORKSPACE_REQUIRED")
const selected = Session.ID.create()
const other = Session.ID.create()
const marker = "synthetic-guardian-objective-123"
const mode = process.env.OPENCODARR_TEST_MODE
if (mode !== "configured" && mode !== "embedded") throw new Error("ISOLATED_TEST_MODE_REQUIRED")
const options = { contract: {
  sessionID: selected, revision: 1, objective: marker, phase: "Observe",
  exclusions: ["Do not call native owners"], checkpoint: "Synthetic checkpoint only", state: "ACTIVE",
} }
const kindHeader = "x-opencodarr-test-request-kind"
// TestLLM captures title and compaction calls too. Label the actual prepared request
// through a public hook so an auxiliary request cannot satisfy the primary oracle.
const requestKind = Plugin.define({
  id: "opencodarr.session-guardian.test-request-kind",
  async setup(ctx) {
    const hook = await ctx.session.hook("model.request", (event) => {
      event.headers[kindHeader] = event.kind
    })
    return () => hook.dispose()
  },
})
const guidance = (request: LLMRequest) => request.system
  .filter((part) => part.text.includes("<opencodarr-session-contract>"))
  .map((part) => part.text)
const primary = (request: LLMRequest) => request.headers?.[kindHeader] === "primary"
const observe = (request: LLMRequest, sessionID: string, input: string) => ({
  sessionBound: request.headers?.["x-opencode-session-id"] === sessionID,
  inputPresent: request.messages.some((message) => message.role === "user" && message.content.some(
    (part) => part.type === "text" && part.text === input,
  )),
  guidance: guidance(request),
})
const summary = "## Objective\n- Synthetic test\n\n## Requirements\n- None\n\n## Decisions\n- None\n\n## Work State\n### Completed\n- None\n\n### Active\n- None\n\n### Blocked\n- None\n\n## Next Move\n1. Continue testing\n\n## Relevant Files\n- None\n\n## Important Context\n- None"

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer({ fallback: TestLLM.text(summary, "answer") })))
  const host = yield* OpenCode.create({
    plugins: [
      PluginPromise.fromPromise(requestKind),
      ...(mode === "embedded" ? [PluginPromise.fromPromise(createSessionGuardian(options))] : []),
    ],
    config: { directory, project: false, content: JSON.stringify({
      plugins: mode === "configured" ? [{ package: fileURLToPath(new URL("..", import.meta.url)), options }] : [],
      model: "custom/fictional-chat", providers: { custom: {
        package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: "https://provider.example/v1" },
        models: { "fictional-chat": {} },
      } },
    }) },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
  }, { overrides: [llmClient.replace(Layer.succeed(LLMClient.Service, llm))] })
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
  yield* host.sessions.create({ id: selected, location })
  yield* host.sessions.create({ id: other, location })
  yield* host.sessions.prompt({ sessionID: selected, text: "test selected" })
  yield* host.sessions.wait({ sessionID: selected })
  const selectedRequests = yield* llm.requests()
  const plugins = yield* host.plugin.list({ location })
  yield* host.sessions.prompt({ sessionID: other, text: "test other" })
  yield* host.sessions.wait({ sessionID: other })
  const bothRequests = yield* llm.requests()
  yield* host.sessions.compact({ sessionID: selected })
  yield* host.sessions.wait({ sessionID: selected })
  const compactedRequests = yield* llm.requests()
  const history = yield* host.sessions.context({ sessionID: selected })
  const selectedInput = "test selected after completed compaction"
  yield* host.sessions.prompt({ sessionID: selected, text: selectedInput })
  yield* host.sessions.wait({ sessionID: selected })
  const continuedRequests = yield* llm.requests()
  const otherInput = "test other after selected compaction"
  yield* host.sessions.prompt({ sessionID: other, text: otherInput })
  yield* host.sessions.wait({ sessionID: other })
  const allRequests = yield* llm.requests()
  const count = (request: (typeof allRequests)[number]) => request.system.filter((part) => part.text.includes(marker)).length
  console.log(JSON.stringify({
    pluginActive: plugins.data.some((plugin) => plugin.id === "opencodarr.session-guardian" && plugin.state.status === "active"),
    selected: selectedRequests.map(count),
    other: bothRequests.slice(selectedRequests.length).map(count),
    compaction: compactedRequests.slice(bothRequests.length).map(count),
    compactionCompleted: history.some((message) => message.type === "compaction" && message.status === "completed"),
    compactionGuidance: compactedRequests.slice(bothRequests.length)
      .filter((request) => request.headers?.[kindHeader] === "compaction")
      .map((request) => ({ sessionBound: request.headers?.["x-opencode-session-id"] === selected, guidance: guidance(request) })),
    nextSelected: continuedRequests.slice(compactedRequests.length).filter(primary)
      .map((request) => observe(request, selected, selectedInput)),
    nextOther: allRequests.slice(continuedRequests.length).filter(primary)
      .map((request) => observe(request, other, otherInput)),
  }))
})))

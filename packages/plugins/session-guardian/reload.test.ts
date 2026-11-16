import { test } from "bun:test"
import assert from "node:assert/strict"
import type { Plugin } from "@opencode/plugin"
import { createSessionGuardian } from "./index"
import type { projectContract } from "./contract"

const id = "opencodarr.session-guardian"
const source = { type: "local", path: "/fixture/session-guardian" } as const
const selected = {
  sessionID: "ses_selected",
  revision: 1,
  objective: "first guarded objective",
  phase: "Observe",
  exclusions: ["Do not change live services"],
  state: "ACTIVE",
}
type Inventory = Awaited<ReturnType<Plugin.Context["plugin"]["list"]>>["data"]
type Event = Parameters<typeof projectContract>[0]
type Hook = (event: Event) => void | Promise<void>

function active(): Inventory {
  return [{ id, source, features: { server: true }, state: { status: "active" } }]
}

// This is a minimal public setup/hook fixture, not the OpenCode host or its reload engine.
// Inventory snapshots correspond to the source-pinned registry and supervisor failure paths.
function fixture(options: unknown = { contract: selected }) {
  const hooks = new Map<string, Hook>()
  const state = {
    inventory: active(),
    reads: 0,
    unreadable: false,
    rejectCompaction: false,
    pending: undefined as Promise<void> | undefined,
  }
  const context = {
    options,
    plugin: {
      async list() {
        state.reads++
        const inventory = state.inventory
        if (state.pending) await state.pending
        if (state.unreadable) throw new Error("INVENTORY_UNAVAILABLE")
        return { location: { directory: "/fixture/workspace" }, data: inventory }
      },
    },
    session: {
      async hook(name: string, callback: Hook) {
        if (name === "compaction" && state.rejectCompaction) throw new Error("REGISTRATION_FAILED")
        hooks.set(name, callback)
        return { dispose() { hooks.delete(name) } }
      },
    },
  }
  // No unused service exists in this fixture. Unexpected capability access fails immediately.
  const scoped = new Proxy(context, {
    get(target, key) {
      if (!(key in target)) throw new Error(`UNEXPECTED_HOST_CAPABILITY:${String(key)}`)
      return Reflect.get(target, key)
    },
  }) as unknown as Plugin.Context
  return {
    hooks,
    state,
    setup: async () => await createSessionGuardian().setup(scoped),
    async project(name: string, sessionID = selected.sessionID) {
      const event: Event = { sessionID, system: [{ type: "text", text: "Existing system guidance" }] }
      const hook = hooks.get(name)
      assert.ok(hook, `missing ${name} hook`)
      await hook(event)
      return event
    },
  }
}

function count(event: Event) {
  return event.system.filter((part) => part.text.startsWith("<opencodarr-session-contract>")).length
}

test("active inventory permits selected-session context and compaction without duplicate projection", async () => {
  const host = fixture()
  const cleanup = await host.setup()
  for (const name of ["context", "compaction"]) {
    const event = await host.project(name)
    assert.equal(count(event), 1)
    assert.equal(event.system[0].text, "Existing system guidance")
    assert.ok(event.system[1].text.includes("does not grant permission"))
    await host.hooks.get(name)?.(event)
    assert.equal(count(event), 1)
  }
  assert.equal(host.state.reads, 4)
  await cleanup?.()
  assert.equal(host.hooks.size, 0)
})

test("a failed setup inventory prevents the restored old contract from projecting", async () => {
  const host = fixture()
  await host.setup()
  assert.equal(count(await host.project("context")), 1)
  // Registry activation may restore the previous plugin while reporting the requested one failed.
  host.state.inventory = [{ id, source, features: { server: true }, state: { status: "failed", error: "SESSION_CONTRACT_INVALID_REVISION" } }]
  assert.equal(count(await host.project("context")), 0)
  assert.equal(count(await host.project("compaction")), 0)
})

test("an anonymous local discovery failure suppresses the retained generation at that exact source", async () => {
  const host = fixture()
  await host.setup()
  host.state.inventory = [...active(), { source, features: { server: true }, state: { status: "failed", error: "IMPORT_FAILED" } }]
  assert.equal(count(await host.project("context")), 0)
  assert.equal(count(await host.project("compaction")), 0)
})

test("package discovery failures match the target independently of the retained version", async () => {
  const host = fixture()
  await host.setup()
  host.state.inventory = [
    { id, source: { type: "package", target: "@fixture/guardian", version: "1.0.0" }, features: { server: true }, state: { status: "active" } },
    { source: { type: "package", target: "@fixture/guardian" }, features: { server: true }, state: { status: "failed", error: "IMPORT_FAILED" } },
  ]
  assert.equal(count(await host.project("context")), 0)
})

test("an unrelated local or package failure does not suppress a healthy Guardian", async () => {
  const host = fixture()
  await host.setup()
  host.state.inventory = [
    ...active(),
    { source: { type: "local", path: "/fixture/session-guardian-other" }, features: { server: true }, state: { status: "failed", error: "IMPORT_FAILED" } },
    { source: { type: "package", target: "@fixture/unrelated" }, features: { server: true }, state: { status: "failed", error: "IMPORT_FAILED" } },
  ]
  assert.equal(count(await host.project("context")), 1)
  assert.equal(count(await host.project("compaction")), 1)
})

test("missing or ambiguous Guardian inventory suppresses guidance", async () => {
  const host = fixture()
  await host.setup()
  for (const inventory of [[], [...active(), ...active()]]) {
    host.state.inventory = inventory
    assert.equal(count(await host.project("context")), 0)
    assert.equal(count(await host.project("compaction")), 0)
  }
})

test("unreadable inventory suppresses guidance without treating it as healthy", async () => {
  const host = fixture()
  await host.setup()
  host.state.unreadable = true
  assert.equal(count(await host.project("context")), 0)
  assert.equal(count(await host.project("compaction")), 0)
  assert.equal(host.state.reads, 2)
})

test("healthy inventory recovery is observed afresh on the next projection", async () => {
  const host = fixture()
  await host.setup()
  host.state.inventory = []
  assert.equal(count(await host.project("context")), 0)
  host.state.inventory = active()
  assert.equal(count(await host.project("context")), 1)
  host.state.unreadable = true
  assert.equal(count(await host.project("compaction")), 0)
  host.state.unreadable = false
  assert.equal(count(await host.project("compaction")), 1)
})

test("an unselected session needs no inventory read and receives no contract", async () => {
  const host = fixture()
  await host.setup()
  host.state.unreadable = true
  assert.equal(count(await host.project("context", "ses_other")), 0)
  assert.equal(count(await host.project("compaction", "ses_other")), 0)
  assert.equal(host.state.reads, 0)
})

test("an absent contract remains inert and invalid options fail before registering a hook", async () => {
  const absent = fixture({})
  await absent.setup()
  assert.equal(absent.hooks.size, 0)
  assert.equal(absent.state.reads, 0)
  const invalid = fixture({ contract: { ...selected, revision: 0 } })
  await assert.rejects(invalid.setup(), /SESSION_CONTRACT_INVALID_REVISION/)
  assert.equal(invalid.hooks.size, 0)
})

test("a later valid setup projects only its own successor contract", async () => {
  const prior = fixture()
  const cleanup = await prior.setup()
  await cleanup?.()
  assert.equal(prior.hooks.size, 0)
  const next = fixture({ contract: { ...selected, revision: 2, objective: "second guarded objective" } })
  await next.setup()
  const event = await next.project("context")
  assert.equal(count(event), 1)
  assert.ok(event.system[1].text.includes('"revision":2'))
  assert.ok(event.system[1].text.includes("second guarded objective"))
  assert.ok(!event.system[1].text.includes(selected.objective))
})

test("a disposed generation cannot finish an in-flight inventory read and project later", async () => {
  const host = fixture()
  const cleanup = await host.setup()
  const pending = Promise.withResolvers<void>()
  host.state.pending = pending.promise
  const projection = host.project("context")
  await cleanup?.()
  pending.resolve()
  assert.equal(count(await projection), 0)
})

test("compaction registration failure removes the context hook", async () => {
  const host = fixture()
  host.state.rejectCompaction = true
  await assert.rejects(host.setup(), /REGISTRATION_FAILED/)
  assert.equal(host.hooks.size, 0)
})

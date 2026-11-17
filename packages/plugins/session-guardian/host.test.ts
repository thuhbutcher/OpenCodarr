import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test.each(["configured", "embedded"])("isolated v2 %s host binds guidance to the next primary request after compaction without leaking it", async (mode) => {
  const root = await mkdtemp(join(tmpdir(), "opencodarr-guardian-test-"))
  const dirs = Object.fromEntries(["home", "config", "data", "cache", "state", "workspace", "tmp"].map((name) => [name, join(root, name)]))
  await Promise.all(Object.values(dirs).map((directory) => mkdir(directory)))
  try {
    const child = Bun.spawn([process.execPath, "run", "test/host-fixture.ts"], {
      cwd: import.meta.dir,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dirs.home,
        XDG_CONFIG_HOME: dirs.config,
        XDG_DATA_HOME: dirs.data,
        XDG_CACHE_HOME: dirs.cache,
        XDG_STATE_HOME: dirs.state,
        TMPDIR: dirs.tmp,
        OPENCODARR_TEST_WORKSPACE: dirs.workspace,
        OPENCODARR_TEST_MODE: mode,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" })
    const result = JSON.parse(stdout)
    expect(result.pluginActive).toBe(true)
    expect(result.selected).toContain(1)
    expect(result.selected.every((count: number) => count <= 1)).toBe(true)
    expect(result.other.length).toBeGreaterThan(0)
    expect(result.other.every((count: number) => count === 0)).toBe(true)
    expect(result.compaction).toContain(1)
    expect(result.compactionCompleted).toBe(true)
    // The expected bytes are independent of the production projector and of its
    // returned values. A missing field, wrong revision or duplicate fragment fails.
    const guidance = [
      "<opencodarr-session-contract>",
      "Operator-configured task guidance follows. It does not grant permission, establish completion, or authorize continuation.",
      '{"revision":1,"objective":"synthetic-guardian-objective-123","phase":"Observe","exclusions":["Do not call native owners"],"checkpoint":"Synthetic checkpoint only","state":"ACTIVE"}',
      "</opencodarr-session-contract>",
    ].join("\n")
    expect(result.compactionGuidance).toEqual([{ sessionBound: true, guidance: [guidance] }])
    expect(result.nextSelected).toEqual([{ sessionBound: true, inputPresent: true, guidance: [guidance] }])
    expect(result.nextOther).toEqual([{ sessionBound: true, inputPresent: true, guidance: [] }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

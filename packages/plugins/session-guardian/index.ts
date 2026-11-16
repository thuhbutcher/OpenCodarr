import { Plugin } from "@opencode/plugin"
import { configuredContract, projectContract } from "./contract"

/** A seeded host can pass options directly; a loaded plugin uses OpenCode's plugin options. */
export function createSessionGuardian(options?: unknown) {
  return Plugin.define({
    id: "opencodarr.session-guardian",
    async setup(ctx) {
      const contract = configuredContract(options === undefined ? ctx.options : options)
      if (!contract) return
      let disposed = false
      const project = async (event: Parameters<typeof projectContract>[0]) => {
        if (disposed || event.sessionID !== contract.sessionID) return
        // OpenCode can retain the previous generation after failed setup or discovery.
        // Its current inventory, rather than successful setup alone, bounds this projection.
        const inventory = await ctx.plugin.list().catch(() => undefined)
        if (disposed || !inventory) return
        const entries = inventory.data.filter((entry) => entry.id === "opencodarr.session-guardian")
        if (entries.length !== 1 || entries[0].state.status !== "active") return
        const source = entries[0].source
        if (inventory.data.some((entry) => entry.state.status === "failed" && (
          (source.type === "local" && entry.source.type === "local" && source.path === entry.source.path) ||
          (source.type === "package" && entry.source.type === "package" && source.target === entry.source.target)
        ))) return
        projectContract(event, contract)
      }
      const context = await ctx.session.hook("context", project)
      try {
        const compaction = await ctx.session.hook("compaction", project)
        return async () => {
          disposed = true
          await compaction.dispose()
          await context.dispose()
        }
      } catch (error) {
        disposed = true
        await context.dispose()
        throw error
      }
    },
  })
}

export default createSessionGuardian()

import { Plugin } from "@opencode/plugin"
import { configuredContract, projectContract } from "./contract"

/** A seeded host can pass options directly; a loaded plugin uses OpenCode's plugin options. */
export function createSessionGuardian(options?: unknown) {
  return Plugin.define({
    id: "opencodarr.session-guardian",
    async setup(ctx) {
      const contract = configuredContract(options === undefined ? ctx.options : options)
      if (!contract) return
      const context = await ctx.session.hook("context", (event) => projectContract(event, contract))
      try {
        const compaction = await ctx.session.hook("compaction", (event) => projectContract(event, contract))
        return async () => {
          await compaction.dispose()
          await context.dispose()
        }
      } catch (error) {
        await context.dispose()
        throw error
      }
    },
  })
}

export default createSessionGuardian()

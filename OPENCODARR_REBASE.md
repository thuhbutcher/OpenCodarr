# OpenCodarr source rebase onto OpenCode 2.3.0

This source-maintenance occurrence carries the existing Session Guardian and isolated pilot launcher onto upstream OpenCode **v2.3.0**, commit `a6b15d33daf6ab7d35569f6d711fdb630b9f04e7`. It is a source candidate, not an installed build or release/readiness verdict.

## Source selection and ancestry

The selected tag was the latest observed stable OpenCode **v2** application release on 14 November 2026. GitHub's generic `/releases/latest` endpoint still returns the legacy v1 line; use the explicit tag and commit.

Original source chain:

| Role | Commit |
|---|---|
| Prior development base | `237a847056522ec78a5c64ab7db5a19736e1ea58` |
| Guardian addition | `dab4a7b412decb14f51c95d72dec8ee6055a5ee8` |
| Isolated launcher addition | `43bff267c1b5e66595adeadb02e66ad88dbd0f36` |
| New upstream base | `a6b15d33daf6ab7d35569f6d711fdb630b9f04e7` |

The two original commits were replayed using `git rebase --onto` onto the selected upstream tag. The only merge conflict was `bun.lock`: preserve the new upstream lock and add Guardian's workspace/package entry. The obsolete `packages/posts` workspace in the old conflict context is not restored. The original branches are retained; this work is on `opencodarr-rebase`.

The follow-up compatibility change pins Guardian's peer dependency to `@opencode/plugin@2.3.0` and updates this occurrence's metadata. The old Guardian and launcher coding envelopes remain historical records. The new `OPENCODARR_REBASE_SDK_SDC.v1.json` binds the before-commit and complete changed-path scope for this occurrence; its AUTHORED declaration does not authenticate test or owner claims.

## Preserved behavior and changed upstream

Guardian still projects only an explicitly configured exact session contract through context and compaction hooks. It does not enforce effects, auto-resume, store checkpoints, or propagate to every child/fork. The pilot still uses a private profile and standalone child, validates a supplied binary digest, and refuses unsafe paths/configuration by default. It is not an OS sandbox or provenance verifier.

OpenCode 2.3.0 includes the upstream SQLite interruption repair and the Effect/SQLite 4.1.0 dependency closure. It also changes background subagent and transcript behavior. These inherited changes must be tested in the actual selected client before declaring an operational migration complete.

Standalone startup still does not invoke the managed-service orphan recovery sweep. Historical event payload retention still defaults off even though the experimental session-log API exists. Broad base permissions and provider model menus do not establish scoped authority or successful inference.

## Verification commands and scope

Use the repository-pinned **Bun 1.4.4** and the retained lockfile. For focused package checks:

```sh
# From the repository root:
bun install --frozen-lockfile
python3 script/opencodarr_pilot_test.py

# From packages/plugins/session-guardian:
bun test contract.test.ts host.test.ts
bun run typecheck

# From packages/core:
bun run script/test.ts test/sqlite-interrupt.test.ts

# Canonical full repository gate, from the repository root:
bun run check
```

The Guardian host tests use isolated synthetic in-process model fixtures. Launcher tests use stub executables. Neither constitutes real provider use, a native deployment, external effect recovery or OpenBrainarr adoption. A frozen dependency installation must succeed before interpreting host/type/SQLite checks as executed coverage.

## Verification result

Executed against this rebased source with Bun 1.4.4:

| Check | Result | Scope |
|---|---|---|
| Guardian contract and configured/embedded host tests | 9 passed, 0 failed | Synthetic model, isolated temporary hosts |
| Isolated pilot launcher | 16 passed, 0 failed | Stub executables and path/environment boundaries |
| Upstream SQLite interruption regression | 4 passed, 0 failed | Selected source/dependency closure |
| Guardian type check | Passed; 1,127 files checked | Full frozen dependency installation |
| Canonical `bun run check` | Passed; 36/36 typecheck tasks; lint 0 errors and 510 warnings | Telemetry disabled, local cache only |

The first focused typecheck lacked root-declared `@types/mime-types` under a filtered dependency installation. The full frozen installation resolved that environment gap; no source workaround was introduced. Dependency lifecycle scripts were disabled in this verification environment. The complete check retains its existing warnings; a passing command does not claim warning-free source.

Use `TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 TURBO_CACHE=local:rw` for a local check without Turbo telemetry/remote caching. This occurrence additionally disabled update notifications and Astro/Next telemetry and passed those controls to child checks.

The associated pull request and external exact-commit receipt bind these results to the published source. No current product-use qualification is implied by this document.

## Recovery and application

The prior refs and commit IDs above provide source rollback. Changing source does not migrate an existing profile or database. Before any installed update, bind the build recipe and digest to this source, preserve the old executable/profile/database, verify the actual provider and effective permissions, and exercise the selected recovery behavior in isolation. Do not attach a mismatched development client to an incumbent managed service as a shortcut.

References: [upstream release](https://github.com/anomalyco/opencode/releases/tag/v2.3.0), [SQLite repair](https://github.com/anomalyco/opencode/pull/60651), [v1/v2 latest-label explanation](https://github.com/anomalyco/opencode/issues/60646).

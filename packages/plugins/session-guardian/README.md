# Session Guardian — source candidate

This first OpenCodarr plugin projects one explicitly configured, non-secret task contract into the selected OpenCode session's context and compaction requests. Its small pure contract module can later be evaluated by the OpenBrainarr owner as a shared component. It is a source candidate, not an installed OpenBrainarr feature.

The plugin is inert when no contract is supplied. A contract binds the exact OpenCode session ID and a positive revision, objective, current phase, exclusions, optional checkpoint, and state (`ACTIVE`, `PAUSED`, `BLOCKED`, or `UNKNOWN_OUTCOME`). The plugin supplies no model-facing action to update it; configuration edits remain governed by the host's permissions. Invalid options fail the plugin setup rather than silently truncating or inventing a contract. The final escaped context fragment is limited to 8,192 UTF-8 bytes. Requests from other sessions are untouched.

This release does **not** enforce permissions, resume work, decide that a goal is complete, own the Brainarr GChat session, create a database, or reconcile a prior host. The operator-supplied configuration is the only persistence in this slice; restart and checkpoint storage are not yet proven. Do not install it next to another context projector until the selected OpenBrainarr host has reconciled the two.

When enabled, contract text becomes model-visible context. Use only material approved for the selected provider; do not put credentials, secrets, private reasoning, or data requiring an unimplemented disclosure decision into it. The plugin does not implement Enforcarr or provider-disclosure authorization, measure the complete context budget, or prove the bytes sent by a real provider transport.

Local configuration example (replace the synthetic session ID and objective deliberately):

```json
{
  "plugins": [{
    "package": "/path/to/session-guardian",
    "options": {
      "contract": {
        "sessionID": "ses_example",
        "revision": 1,
        "objective": "Inspect the selected project source",
        "phase": "Observe",
        "exclusions": ["Do not modify live services"],
        "checkpoint": "Source inventory pending",
        "state": "ACTIVE"
      }
    }
  }]
}
```

The example is not an instruction to alter a live configuration. The plugin's source was developed against isolated OpenCode v2.1.4 and separately exercised against the v2.2.2 development baseline. These are distinct test populations; they do not prove compatibility with other versions. The synthetic host fixture uses the matching version's AI testing import. Native OpenBrainarr adoption needs exact source/owner compatibility, selected SDK/SDC and relevant Contract Packs, focused tests, and an independent receiving disposition.

From this package directory, `bun test` runs bounded contract tests and two isolated embedded OpenCode host fixtures: one loads this package from configuration and one registers it programmatically. The hosts use fresh temporary directories and a synthetic in-process model; neither contacts a real provider. `bun run typecheck` and `bun run typecheck:tsc` are separate type checks. These checks do not establish an installed product or a provider-wire receipt.

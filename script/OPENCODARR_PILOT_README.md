# OpenCodarr isolated pilot launcher

This local Linux pilot starts a selected OpenCodarr executable with its own home, XDG data/config/cache/state/runtime roots, temporary directory and `--standalone` server. It does not select or change the operator's existing OpenCode service. It is a development candidate, not an installed or released product.

Supply an executable whose version and provenance were separately verified, its expected SHA-256, an absolute profile path and an existing absolute workspace directory. The caller-supplied hash is a consistency check, not proof of provenance. The profile and workspace must be disjoint. A profile must be new, empty and private, or already contain this launcher's marker for the **same binary hash**. A different binary needs a new profile until migration and rollback are qualified. Common OpenCode state/configuration paths and explicit inherited OpenCode config/database paths cannot be used as the profile. Existing profile symlinks pointing outside its root are rejected.

```sh
python3 script/opencodarr-pilot.py \
  --binary /absolute/path/to/opencodarr \
  --sha256 <64-lowercase-hex-digest> \
  --profile /absolute/path/to/new-private-profile \
  --workspace /absolute/path/to/project \
  --check
```

`--check` validates the selected paths and binary hash without creating the profile or starting the program. Remove `--check` to start the interactive candidate. The parent of a new profile must already exist. A successful precheck is not a successful launch, writable-storage guarantee, installed selection or runtime qualification.

The launcher passes terminal settings and PATH but does not forward inherited provider credentials, OpenCode configuration/password overrides, or arbitrary environment variables. In the default mode, OpenCode's project config **and all project instruction discovery** are disabled, so this mode accepts only an empty workspace for a disposable smoke test. If `AGENTS.md` is present in the selected workspace or any ancestor, the launcher also refuses to start in default mode; this conservative check can include a file above OpenCode's actual project root. For actual work in a trusted project, pass `--with-project-config` to enable both project configuration and instruction discovery. This can load that workspace's OpenCode settings and plugins, so select the workspace deliberately. The ancestor check is not a complete inventory of all nested instructions.

Claude compatibility, model-catalog fetching, auto-update and system Git config are disabled for this pilot. The pinned OpenCode source can also discover `/etc/opencode`; the launcher stops before starting when that system path exists, without reading or changing it. The profile is persistent until its rightful operator removes or migrates it. Configure any provider deliberately in that separate profile; do not copy secrets from the existing OpenCode installation as part of this prototype. The launcher's isolated profile does not automatically carry user instructions from another conversation.

This wrapper is **not an operating-system sandbox**: once launched, the program and any permitted tools run with the operator's normal filesystem and network permissions. It does not enforce Enforcarr policy, provide automatic recovery, enable Session Guardian, or prevent disclosure to a provider the operator chooses. The existing plugin remains a separate local candidate. The marker binds a profile to a binary hash; it is not an installation-completion receipt. If profile initialization fails, the next invocation checks the marker and existing roots again before creating missing roots. A host or user can still change paths or replace the executable between its hash check and execution; this small launcher is not a hostile-concurrency guarantee.

The repository test `python3 -m unittest script/opencodarr_pilot_test.py -v` exercises profile isolation and negative cases with a stub executable in disposable directories. A real interactive terminal run needs its own receipt, and no real provider turn or OpenBrainarr adoption is implied.

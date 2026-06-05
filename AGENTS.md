# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-04
**Commit:** 64fbcd0
**Branch:** main

## OVERVIEW
OpenCode plugin + CLI tool that mitigates npm supply chain attacks by gating updates behind a configurable maturity cooldown. Checks CLI, project deps, and plugins at session start. Interactive TUI for manual updates. Shell wrapper for pre-launch checks. One runtime dependency (`@clack/prompts`).

## STRUCTURE
```
./
├── src/                # Plugin + CLI source (13 modules, ~2000 lines)
│   ├── index.ts        # Plugin entry — hooks, toast, blocked-package gating
│   ├── cli.ts          # CLI entry (opencode-update binary) — modes: interactive, --pre-launch, --uninstall-hook
│   ├── cli/            # CLI submodules (re-exported through cli.ts for tests)
│   │   ├── install.ts  # Package install logic, config version update, launch opencode
│   │   └── select.ts   # Interactive TUI — partition, confirm, version selection
│   ├── update-check.ts # npm registry queries, findBestUpdate, semver comparison
│   ├── report.ts       # Report formatting (mature/waiting/unknown)
│   ├── config.ts       # Maturity config, debug flag, config dir resolution
│   ├── cooldown.ts     # 24h cooldown with fingerprint invalidation
│   ├── helpers.ts      # Shell exec (sync + async), JSONC parser, version utils
│   ├── shell.ts        # Shell wrapper detection/install (bash/zsh/fish)
│   ├── setup.ts        # Startup checks — autoupdate disable, shell hook install
│   ├── debug.ts        # Debug logging to XDG cache
│   └── types.ts        # UpdateInfo, DetailedUpdateInfo, VersionInfo
├── test/               # Vitest tests (13 files, ~2900 lines)
├── bin/
│   ├── install.cjs     # Postinstall: registers plugin + disables autoupdate
│   └── generate-schema.cjs  # Generates update-guard.schema.json from config.ts
├── scripts/release.ts  # Interactive release: bump → tag → push (Bun)
├── update-guard.schema.json  # JSON Schema for user config (committed, in files[])
└── dist/               # Compiled output (gitignored)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin entry point | `src/index.ts:45` | `updateGuardPlugin` — default export, returns Hooks |
| CLI entry point | `src/cli.ts:177` | `main()` / `runPreLaunch()` / `handleUninstallHook()` |
| Update check logic | `src/update-check.ts:68` | `checkForUpdates` + `checkAllUpdates` + `findBestUpdate` |
| Report formatting | `src/report.ts:5` | `buildUpdateReport` — mature/waiting/unknown buckets |
| Config loading | `src/config.ts:37` | `loadConfig` — reads update-guard.jsonc |
| Cooldown + fingerprint | `src/cooldown.ts:62` | `shouldCheck`/`markChecked`/`computeFingerprint` |
| Shell wrapper | `src/shell.ts` | `detectShell`/`installHook`/`uninstallHook` — bash/zsh/fish |
| Startup checks | `src/setup.ts:132` | `runStartupChecks` — autoupdate + shell hook prompts |
| Interactive selection | `src/cli/select.ts` | `selectVersions`/`partitionVersions`/`confirmImmatureUpdates` |
| Package install | `src/cli/install.ts:56` | `installPackage`/`installUpdates`/`updatePluginVersionInConfig` |
| Debug logging | `src/debug.ts` | `debugLog` — writes to `~/.cache/opencode/update-guard-debug.log` |
| JSONC parser | `src/helpers.ts:87` | `parseJsonc` — hand-rolled, handles comments outside strings |
| Plugin registration | `bin/install.cjs` | Writes to `$XDG_CONFIG_HOME/opencode/opencode.json` |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `updateGuardPlugin` | const | src/index.ts:45 | Plugin factory (default export) — returns Hooks |
| `showToast` | fn | src/index.ts:32 | Toast notification via TUI |
| `main` | fn | src/cli.ts:177 | CLI interactive mode entry |
| `runPreLaunch` | fn | src/cli.ts:211 | Shell wrapper pre-launch check |
| `handleUninstallHook` | fn | src/cli.ts:284 | Remove shell wrapper |
| `buildUpdateSummary` | fn | src/cli.ts:49 | Human-readable update summary for CLI |
| `checkForUpdates` | fn | src/update-check.ts:68 | Queries npm for CLI/deps/plugins (single-version) |
| `checkAllUpdates` | fn | src/update-check.ts:153 | Multi-version update check (DetailedUpdateInfo) |
| `findBestUpdate` | fn | src/update-check.ts:24 | Finds newest mature version across all versions |
| `semverGt` | fn | src/update-check.ts:11 | Numeric semver comparison |
| `buildUpdateReport` | fn | src/report.ts:5 | Formats mature/waiting/unknown into text |
| `loadConfig` | fn | src/config.ts:37 | Reads update-guard.jsonc, sets maturity + debug |
| `isMature` | fn | src/config.ts:23 | Checks if age exceeds maturity threshold |
| `ensureConfigFile` | fn | src/config.ts:57 | Creates default config if missing |
| `getConfigDir` | fn | src/config.ts:31 | Resolves XDG config directory |
| `isDebugEnabled` | fn | src/config.ts:27 | Checks debug flag from config |
| `shouldCheck` | fn | src/cooldown.ts:62 | 24h cooldown gate with fingerprint bypass |
| `markChecked` | fn | src/cooldown.ts:99 | Writes cooldown timestamp + cached updates |
| `computeFingerprint` | fn | src/cooldown.ts:40 | Config content + plugin version hash |
| `installPackage` | fn | src/cli/install.ts:56 | `npm install -g` for cli or plugin |
| `installUpdates` | fn | src/cli/install.ts:81 | Batch install with spinner |
| `updatePluginVersionInConfig` | fn | src/cli/install.ts:13 | Updates version in opencode.json |
| `launchOpencode` | fn | src/cli/install.ts:109 | Spawns opencode as child process |
| `selectVersions` | fn | src/cli/select.ts:146 | Interactive version picker (mature/all/individual) |
| `selectVersionsPreLaunch` | fn | src/cli/select.ts:285 | Pre-launch install-or-skip prompt |
| `partitionVersions` | fn | src/cli/select.ts:24 | Split versions into newestMature + immature |
| `confirmImmatureUpdates` | fn | src/cli/select.ts:77 | Confirmation prompt for immature installs |
| `detectShell` | fn | src/shell.ts:48 | Detects bash/zsh/fish + config path |
| `installHook` | fn | src/shell.ts:201 | Writes shell wrapper to config file |
| `uninstallHook` | fn | src/shell.ts:224 | Removes shell wrapper from config file |
| `runStartupChecks` | fn | src/setup.ts:132 | Interactive autoupdate + shell hook setup |
| `checkAutoupdateDisabled` | fn | src/setup.ts:22 | Checks if autoupdate is false in config |
| `disableAutoupdate` | fn | src/setup.ts:40 | Writes `autoupdate: false` to config |
| `debugLog` | fn | src/debug.ts:12 | Conditional log to XDG cache file |
| `parseJsonc` | fn | src/helpers.ts:87 | Strips `//` and `/* */` comments (not inside strings) |
| `readJsonc` | fn | src/helpers.ts:139 | Reads file + parseJsonc |
| `execQuiet` | fn | src/helpers.ts:7 | `execSync` wrapper, returns empty string on failure |
| `execQuietAsync` | fn | src/helpers.ts:18 | Async `exec` wrapper |
| `getLatestVersion` | fn | src/helpers.ts:29 | `npm view <pkg> version` |
| `getPublishedEpoch` | fn | src/helpers.ts:34 | `npm view <pkg> time --json` → epoch seconds |
| `getPublishedTimes` | fn | src/helpers.ts:47 | `npm view <pkg> time --json` → all version epochs |
| `getPublishedTimesAsync` | fn | src/helpers.ts:63 | Async version of getPublishedTimes |
| `formatAge` | fn | src/helpers.ts:81 | Formats seconds as `Xd Yh` |
| `UpdateInfo` | iface | src/types.ts:1 | `{ type, name, current, latest, ageSeconds }` |
| `DetailedUpdateInfo` | iface | src/types.ts:14 | `{ type, name, current, versions: VersionInfo[] }` |
| `VersionInfo` | iface | src/types.ts:9 | `{ version, ageSeconds }` |
| `InstallItem` | iface | src/cli/install.ts:75 | `{ name, version, type }` |

## CONVENTIONS

- **ESM source, CJS install script**: `src/` is `"type": "module"`. `bin/*.cjs` is explicitly `.cjs` because postinstall and schema generation must work without ESM support.
- **Duplicated parseJsonc**: Exists in both `src/helpers.ts` and `bin/install.cjs`. Intentional — they target different module systems and cannot share imports. Any fix must be applied in both.
- **cli.ts is barrel + monolith**: `src/cli.ts` contains all CLI logic AND re-exports from `src/cli/` submodules. The re-exports exist so tests can import from `cli.ts` without reaching into submodules.
- **Biome for linting/formatting**: Replaces ESLint + Prettier. Config in `biome.json` — tabs, double quotes, recommended rules, cognitive complexity limit 25. Only scans `src/**` and `bin/**` (not `test/`).
- **Pre-commit hooks**: `simple-git-hooks` + `lint-staged` — biome fix → tsc → schema gen (on config.ts change) → vitest run.
- **Bun for dev, npm for CI/publish**: `bun.lock` committed; `package-lock.json` gitignored. CI uses `bun install --frozen-lockfile` then `npm run` for scripts.
- **No published source**: `"files": ["dist", "bin", "update-guard.schema.json"]` — `src/` excluded from npm package.
- **TDD test style**: 6 test files use RED/GREEN phase comments. Tests use `vi.mock()` at module level, `vi.mocked()` for typed mocks, selective import spreading for partial node built-in mocks.

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER modify maturity default without considering security implications** — this is the core safety gate
- **NEVER add runtime dependencies lightly** — `@clack/prompts` is the sole dep, added for CLI TUI only. The plugin core (loaded by OpenCode) must remain lightweight.
- **NEVER use `@ts-ignore` or `as any`** — tsconfig has `strict: true`
- **NEVER commit `dist/`** — it's in `.gitignore`, regenerated by `tsc`
- **NEVER touch cooldown cache file** outside `src/cooldown.ts`
- **NEVER use ESLint or Prettier** — project uses Biome exclusively
- **NEVER use `npm` for local dev** — always use `bun` (`bun run`, `bun add`, `bun add -D`). npm is only for CI/publishing.
- **NEVER update parseJsonc in only one location** — must sync `src/helpers.ts` and `bin/install.cjs`

## COMMANDS
```bash
bun run build           # tsc → dist/
bun run clean           # rm -rf dist
bun run test            # vitest run
bun run lint            # biome check
bun run lint:fix        # biome check --fix
bun run format          # biome format
bun run format:fix      # biome format --write
bun run ci              # biome check --fix && tsc && vitest run (local CI)
bun run cli             # Run CLI directly via tsx
bun run release         # Interactive release (bun scripts/release.ts)
bun run logs            # View debug log from ~/.cache/opencode/
bun run prepublishOnly  # clean + build (runs before npm publish)
bun add -D <pkg>        # Add dev dependency
bun add <pkg>           # Add dependency
```

## NOTES

- **Three entry points**: Plugin runtime (`src/index.ts`), CLI binary (`src/cli.ts` → `dist/cli.js` as `opencode-update`), postinstall (`bin/install.cjs`). Each boots independently.
- **CLI modes**: `opencode-update` (interactive), `opencode-update --pre-launch` (shell wrapper), `opencode-update --all` (install all), `opencode-update --uninstall-hook`
- **Configurable maturity**: users set `maturityDays` in `$XDG_CONFIG_HOME/opencode/update-guard.jsonc` (default: 3). Schema at `update-guard.schema.json`.
- **Debug logging**: Set `"debug": true` in config → writes to `~/.cache/opencode/update-guard-debug.log`
- **Plugin hooks**: `event` (session.created/updated), `permission.ask` (block immature), `command.execute.before` (inject warnings), `experimental.chat.system.transform` (inject MUST NOT install directive)
- **Cooldown bypass**: Fingerprint includes config content + plugin version — changes bypass the 24h cooldown
- **Shell wrapper**: Pre-launch check runs before every `opencode` invocation via shell function in `.bashrc`/`.zshrc`/`config.fish`
- **Release flow**: `bun run release` → picks bump → `npm version` → git push + tag → triggers `.github/workflows/release.yml` (lint → test → build → publish with provenance)
- **No PR CI**: Only release workflow exists (triggered on `v*` tag push). Quality relies on pre-commit hooks.
- **`@opencode-ai/sdk`** imported but not listed in dependencies (provided at runtime by OpenCode). `@opencode-ai/plugin` is a peerDependency.
- **Module-level singleton state**: Plugin uses module-scoped `blockedPackages`, `client`, `lastReport`, `updateCheckDone` — not class or closure scoped.
- MIT license in `package.json` only (no LICENSE file)
- tsconfig excludes `test/` — Vitest handles test compilation via Vite
- 13 test files, ~2900 lines — no vitest.config.ts, all convention defaults

# opencode-update-guard

An [OpenCode](https://opencode.ai) plugin that replaces automatic npm updates with a maturity-gated system. Instead of pulling the latest version immediately, Update Guard waits until a package has been published long enough to be considered safe.

## Why?

OpenCode and its plugins update automatically by default. When a malicious package is published to npm, auto-updaters can pull it in before anyone has time to notice. This plugin replaces that flow with a **maturity cooldown**: updates are detected at session start, but only flagged for install once they've been live on npm long enough to be considered safe.

## How it works

On every new OpenCode session, Update Guard checks three sources for available updates:

1. **OpenCode CLI** (`opencode-ai` on npm)
2. **Project dependencies** (from the project's `package.json`)
3. **OpenCode plugins** (from the global `~/.config/opencode/opencode.json`)

For each available update, it finds the **most recent version that is both newer than installed and past the maturity cooldown**. If no mature version exists, the latest version is reported as waiting. This means you'll be notified about a safe intermediate update even if the absolute latest is still too fresh.

| Status | Meaning |
|---|---|
| **Ready to install** | Published past the maturity cooldown |
| **Waiting for maturity** | Published recently, cooldown period not yet elapsed |
| **Age unknown** | Publish time could not be determined from the npm registry |

The plugin also **actively blocks immature updates**. If an OpenCode agent tries to install a package that hasn't matured yet, the plugin intercepts the request and warns you. It does the same for direct package manager commands (npm, yarn, pnpm, bun) run inside OpenCode.

Checks run **once per 24 hours** with a fingerprint-based cache. The cooldown is automatically bypassed if the config file or the plugin itself is updated.

## Install

```bash
npm install -g opencode-update-guard
```

The postinstall script automatically:
- Registers the plugin in your global `opencode.json` (`~/.config/opencode/opencode.json`)
- Disables OpenCode's built-in autoupdate (`"autoupdate": false`) so Update Guard becomes the sole update authority

To re-enable auto-update, remove the plugin and set `"autoupdate": true` in your `opencode.json`.

## Updating packages

Run the interactive updater from any terminal:

```bash
opencode-update
```

This presents a multi-select checklist of mature updates. Pick which ones to install and the tool handles the rest.

```
┌  Update Guard
│
◆  Found 3 update(s)
│
│  Available Updates ───────────────────────────────────────────────────╮
│                                                                       │
│    3 update(s) ready to install:                                      │
│      • opencode 1.14.51 → 1.15.0 (5d 2h old)                         │
│      • oh-my-openagent 4.0.0 → 4.1.2 (4d 8h old)                     │
│      • @cortexkit/opencode-magic-context 0.18.0 → 0.20.0 (3d 19h old) │
│                                                                       │
├───────────────────────────────────────────────────────────────────────╯
│
◆  Select updates to install
│  ○ opencode 1.14.51 → 1.15.0 (5d 2h old)
│  ● oh-my-openagent 4.0.0 → 4.1.2 (4d 8h old)
│  ● @cortexkit/opencode-magic-context 0.18.0 → 0.20.0 (3d 19h old)
│
└  2 package(s) updated
```

CLI and plugin updates are installed via `npm install -g`. Project dependency updates show the command to run manually.

## Configuration

Create or edit `~/.config/opencode/update-guard.jsonc`:

```jsonc
{
  // Point your editor to the schema for autocomplete and validation
  "$schema": "https://github.com/kyubiware/opencode-update-guard/raw/main/update-guard.schema.json",

  // Minimum age (in days) a package version must be before it's considered
  // "mature" enough to install. Default: 3
  "maturityDays": 2,

  // Enable debug logging to diagnose plugin issues.
  // Logs are written to ~/.cache/opencode/update-guard-debug.log
  "debug": false
}
```

| Setting | Default | Description |
|---|---|---|
| `maturityDays` | 3 | How long a version must be published before it's considered safe to install |
| `debug` | `false` | Enable debug logging for troubleshooting |
| Check frequency | 24 hours | Minimum time between update checks (not configurable) |

Cache and log files are stored in `~/.cache/opencode/`:
- `update-guard-last-check` — check cooldown state (auto-invalidated on config or plugin version changes)
- `update-guard-debug.log` — debug output (only written when `debug: true`)

## Debugging

To troubleshoot issues, enable debug mode in your config and restart OpenCode:

```jsonc
{ "debug": true }
```

Then view the logs:

```bash
cat ~/.cache/opencode/update-guard-debug.log
```

## Manual setup

If you prefer to register the plugin manually, add it to your `opencode.json`:

```json
{
  "plugin": ["opencode-update-guard"]
}
```

## License

MIT

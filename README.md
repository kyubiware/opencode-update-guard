# opencode-update-guard

An [OpenCode](https://opencode.ai) plugin that mitigates npm supply chain attack risk by replacing OpenCode's auto-update behavior with a maturity-gated update system.

> **⚠️ Work in progress.** This plugin is early-stage and untested. Use at your own risk.

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
| **Age unknown** | Publish time couldn't be determined |

Checks run **once per 24 hours** with a fingerprint-based cache — the cooldown is automatically bypassed if the config file or the plugin itself is updated.

## Install

```bash
npm install -g opencode-update-guard
```

The postinstall script automatically registers the plugin in your global `opencode.json` (`~/.config/opencode/opencode.json`).

## Manual setup

If you prefer to register manually, add the plugin to your `opencode.json`:

```json
{
  "plugin": ["opencode-update-guard"]
}
```

## Output example

```
**Update Guard** — 3-day maturity cooldown

**Ready to install:**
  - `opencode` 0.4.1 → 0.4.3 (5d 2h old)

**Waiting for maturity:**
  - `some-plugin` 1.0.0 → 1.1.0 (1d 3h old, 1d 21h remaining)
```

## Configuration

Create or edit `~/.config/opencode/update-guard.jsonc`:

```jsonc
{
  // "$schema": "https://github.com/kyubiware/opencode-update-guard/raw/main/update-guard.schema.json",

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

## Debugging

To troubleshoot issues, enable debug mode in your config and restart OpenCode:

```jsonc
{ "debug": true }
```

Then view the logs:

```bash
npm run logs
```

The log file is at `~/.cache/opencode/update-guard-debug.log`.

## License

MIT

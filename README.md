# opencode-update-guard

An [OpenCode](https://opencode.ai) plugin that mitigates npm supply chain attack risk by replacing OpenCode's auto-update behavior with a maturity-gated update system.

> **⚠️ Work in progress.** This plugin is early-stage and untested. Use at your own risk.

## Why?

OpenCode and its plugins update automatically by default. When a malicious package is published to npm, auto-updaters can pull it in before anyone has time to notice. This plugin replaces that flow with a **3-day maturity cooldown**: updates are detected at session start, but only flagged for install once they've been live on npm long enough to be considered safe.

## How it works

On every new OpenCode session, Update Guard checks three sources for available updates:

1. **OpenCode CLI** (`opencode-ai` on npm)
2. **Project dependencies** (from `package.json`)
3. **OpenCode plugins** (from `opencode.json` / `opencode.jsonc`)

For each available update, it looks up the publish time on npm and classifies it:

| Status | Meaning |
|---|---|
| **Ready to install** | Published 3+ days ago |
| **Waiting for maturity** | Published recently, cooldown period not yet elapsed |
| **Age unknown** | Publish time couldn't be determined |

Checks run **once per 24 hours** (cached in `.cache/update-guard-last-check`).

## Install

```bash
npm install opencode-update-guard
```

The postinstall script automatically registers the plugin in your `opencode.json`.

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

## Disabling auto-updates

This plugin reports available updates but doesn't block OpenCode's built-in auto-update mechanism on its own. To fully disable auto-updates, set the following in your `opencode.json`:

```json
{
  "autoUpdate": false
}
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| Maturity cooldown | 3 days | How long a version must be published before it's considered safe to install |
| Check frequency | 24 hours | Minimum time between update checks |

These are currently hardcoded. Configurable options may be added in a future release.

## License

MIT

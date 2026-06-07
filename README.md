# opencode-update-guard

[![npm version](https://img.shields.io/npm/v/opencode-update-guard)](https://www.npmjs.com/package/opencode-update-guard)

A CLI tool and shell wrapper that gates npm updates behind a configurable maturity cooldown for OpenCode.

## Why?

OpenCode auto-updates by default. When a malicious package hits npm, an auto-updater can pull it in before anyone notices. Supply chain attacks on npm are not theoretical. They are a recurring, demonstrated risk.

This tool replaces the auto-update flow with a **maturity cooldown**. New versions are tracked, but they are only offered for install once they have been live on npm long enough to be considered safe.

## How it works

Update Guard checks for available updates to:

1. **OpenCode CLI** (`opencode-ai` on npm)

For each available update, it finds the **most recent version that is both newer than installed and past the maturity cooldown**. If the absolute latest is too fresh but an intermediate version is mature, that intermediate version is offered. If no mature version exists, the latest is reported as waiting.

| Status | Meaning |
|---|---|
| **Ready to install** | Published past the maturity cooldown |
| **Waiting for maturity** | Published recently, cooldown period not yet elapsed |
| **Age unknown** | Publish time could not be determined from the npm registry |

### Defense layers

Update Guard uses three layers to stop immature packages from being installed:

1. **Disables auto-updates** — Sets `autoupdate: false` in OpenCode's config at install time. Prevents silent background updates.

2. **Shell wrapper pre-launch check** — Every `opencode` invocation checks for mature updates first. No updates? Launches silently. Updates available? Shows the interactive selector.

3. **Interactive CLI tool** — `opencode-update` provides a TUI for controlled, manual updates with maturity information.

### Check frequency and cache

Checks run **once per 24 hours** with a cooldown cache. The cooldown is immediately bypassed if the config file or tool version changes.

## Install

```bash
npm install -g opencode-update-guard
```

The postinstall script automatically:
- Disables OpenCode's built-in autoupdate (`"autoupdate": false`) so Update Guard becomes the sole update authority

To re-enable auto-update, set `"autoupdate": true` in your opencode.json.

## Updating packages

Run the interactive updater from any terminal:

```bash
opencode-update
```

This presents a summary with two sections: "Ready to install" (mature) and "Waiting for maturity" (immature). You then choose one of three selection modes:

- **Install mature only** — installs all mature updates immediately
- **Install all** — installs everything, with a confirmation step for immature packages
- **Select individually** — multi-select with visual indicators: ready packages show a checkmark, waiting packages show an hourglass

Use `--all` or `-a` to bypass the menu and install everything directly (still confirms immature packages):

```bash
opencode-update --all
```

Updates are installed via `npm install -g`. After installation, the tool prompts you to restart OpenCode.

```
┌  Update Guard
│
◆  Found 1 update(s)
│
│  Available Updates ───────────────────────────────────────────────────╮
│                                                                       │
│    1 update(s) ready to install:                                      │
│      • opencode 1.14.51 → 1.15.0 (5d 2h old)                         │
│                                                                       │
├───────────────────────────────────────────────────────────────────────╯
│
◆  Select updates to install
│  ● opencode 1.14.51 → 1.15.0 (5d 2h old)
│
└  1 package(s) updated
```

## Shell wrapper (automatic pre-launch checks)

After installing, run `opencode-update` once. It auto-detects whether autoupdate is disabled and whether the shell wrapper is configured, prompting you to set up either if needed.

Once configured, every `opencode` invocation runs the update check first:
- **No mature updates found**: launches opencode silently
- **Mature updates available**: shows the interactive update selector, then launches opencode

The wrapper is a shell function:

**Bash / Zsh** (`~/.bashrc` or `~/.zshrc`):
```bash
# opencode-update-guard pre-launch wrapper
opencode() {
    opencode-update --pre-launch "$@"
}
```

**Fish** (`~/.config/fish/config.fish`):
```fish
# opencode-update-guard pre-launch wrapper
function opencode
    opencode-update --pre-launch $argv
end
```

### Uninstalling the wrapper

```bash
opencode-update --uninstall-hook
```

Or manually: remove the block between the `# opencode-update-guard` marker and the closing `}` (bash/zsh) or `end` (fish) from your shell config.

## Configuration

Create or edit `~/.config/opencode/update-guard.jsonc`:

```jsonc
{
  // Point your editor to the schema for autocomplete and validation
  "$schema": "https://github.com/kyubiware/opencode-update-guard/raw/main/update-guard.schema.json",

  // Minimum age (in days) a package version must be before it's considered
  // "mature" enough to install. Default: 3
  "maturityDays": 2,

  // Enable debug logging to diagnose issues.
  // Logs are written to ~/.cache/opencode/update-guard-debug.log
  "debug": false
}
```

| Setting | Type | Default | Description |
|---|---|---|---|
| `$schema` | string | (commented out) | Points to the schema URL for editor autocomplete |
| `maturityDays` | number (≥0) | 3 | How long a version must be published before it's safe to install |
| `debug` | boolean | false | Enable debug logging to `~/.cache/opencode/update-guard-debug.log` |
| `autoupdateDismissed` | boolean | false | When true, suppresses the autoupdate prompt at startup. Set automatically when you choose "don't ask again" in the prompt. |

**Check frequency:** 24 hours (hardcoded, not configurable)

**Cooldown bypass:** If the config file or tool version changes, the cooldown is bypassed immediately.

Cache and log files are stored in `~/.cache/opencode/`:
- `update-guard-last-check` — cooldown state (auto-invalidated on config or tool version changes)
- `update-guard-debug.log` — debug output (only written when `debug: true`)

## Debugging

To troubleshoot issues, enable debug mode in your config and run `opencode-update` again:

```jsonc
{ "debug": true }
```

Then view the logs:

```bash
cat ~/.cache/opencode/update-guard-debug.log
```

## License

MIT

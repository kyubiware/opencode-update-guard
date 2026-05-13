/**
 * OpenCode Update Guard Plugin
 *
 * Checks for dependency updates with a maturity cooldown on session start.
 * Notifies the user and prompts to install mature updates.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Plugin, Hooks, PluginOptions } from "@opencode-ai/plugin";

// ── Configuration ──────────────────────────────────────────────

const MATURITY_DAYS = 3;
const MATURITY_SECS = MATURITY_DAYS * 86400;
const COOLDOWN_FILE = "update-guard-last-check";

// ── Types ──────────────────────────────────────────────────────

interface UpdateInfo {
  type: "cli" | "pkg" | "plugin";
  name: string;
  current: string;
  latest: string;
  ageSeconds: number;
}

// ── Helpers ────────────────────────────────────────────────────

function execQuiet(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function getLatestVersion(pkg: string): string | null {
  const result = execQuiet(`npm view ${pkg} version`);
  return result || null;
}

function getPublishedEpoch(pkg: string, version: string): number | null {
  const result = execQuiet(`npm view ${pkg} time --json`);
  if (!result) return null;
  try {
    const times = JSON.parse(result) as Record<string, string>;
    const iso = times[version];
    if (!iso) return null;
    return Math.floor(new Date(iso).getTime() / 1000);
  } catch {
    return null;
  }
}

function formatAge(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function isMature(ageSeconds: number): boolean {
  return ageSeconds >= MATURITY_SECS;
}

function parseJsonc(content: string): unknown {
  let result = "";
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < content.length) {
    const ch = content[i];
    if (escape) { result += ch; escape = false; i++; continue; }
    if (ch === "\\") { result += ch; escape = true; i++; continue; }
    if (ch === '"') { inString = !inString; result += ch; i++; continue; }
    if (inString) { result += ch; i++; continue; }
    if (ch === "/" && content[i + 1] === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }

  return JSON.parse(result);
}

function readJsonc(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return parseJsonc(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ── Update Check ───────────────────────────────────────────────

function checkForUpdates(directory: string): UpdateInfo[] {
  const updates: UpdateInfo[] = [];
  const nowEpoch = Math.floor(Date.now() / 1000);

  // 1. Check OpenCode CLI
  const currentCli = execQuiet("opencode --version");
  if (currentCli) {
    const latestCli = getLatestVersion("opencode-ai");
    if (latestCli && currentCli !== latestCli) {
      const pubEpoch = getPublishedEpoch("opencode-ai", latestCli);
      updates.push({
        type: "cli",
        name: "opencode",
        current: currentCli,
        latest: latestCli,
        ageSeconds: pubEpoch ? nowEpoch - pubEpoch : -1,
      });
    }
  }

  // 2. Check package.json dependencies
  const pkgConfig = readJsonc(path.join(directory, "package.json"));
  const deps = (pkgConfig?.dependencies ?? {}) as Record<string, string>;
  for (const [name, version] of Object.entries(deps)) {
    const current = version.replace(/^[\^~>=<]+/, "");
    const latest = getLatestVersion(name);
    if (latest && current !== latest) {
      const pubEpoch = getPublishedEpoch(name, latest);
      updates.push({
        type: "pkg",
        name,
        current,
        latest,
        ageSeconds: pubEpoch ? nowEpoch - pubEpoch : -1,
      });
    }
  }

  // 3. Check opencode.json plugins
  let configPath = path.join(directory, "opencode.json");
  if (!fs.existsSync(configPath)) {
    configPath = path.join(directory, "opencode.jsonc");
  }
  const openCodeConfig = readJsonc(configPath);
  const plugins = (openCodeConfig?.plugin ?? []) as string[];

  for (const pluginRef of plugins) {
    const match = pluginRef.match(/^(@?[^@]+)@(.+)$/);
    if (!match) continue;
    const [, name, current] = match;
    const latest = getLatestVersion(name);
    if (latest && current !== latest) {
      const pubEpoch = getPublishedEpoch(name, latest);
      updates.push({
        type: "plugin",
        name,
        current,
        latest,
        ageSeconds: pubEpoch ? nowEpoch - pubEpoch : -1,
      });
    }
  }

  return updates;
}

function buildUpdateReport(updates: UpdateInfo[]): string {
  const lines: string[] = [];
  const mature = updates.filter((u) => u.ageSeconds >= MATURITY_SECS);
  const waiting = updates.filter((u) => u.ageSeconds >= 0 && u.ageSeconds < MATURITY_SECS);
  const unknown = updates.filter((u) => u.ageSeconds < 0);

  lines.push(`**Update Guard** — ${MATURITY_DAYS}-day maturity cooldown`);
  lines.push("");

  if (mature.length > 0) {
    lines.push("**Ready to install:**");
    for (const u of mature) {
      lines.push(`  - \`${u.name}\` ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`);
    }
    lines.push("");
  }

  if (waiting.length > 0) {
    lines.push("**Waiting for maturity:**");
    for (const u of waiting) {
      const remaining = formatAge(MATURITY_SECS - u.ageSeconds);
      lines.push(`  - \`${u.name}\` ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old, ${remaining} remaining)`);
    }
    lines.push("");
  }

  if (unknown.length > 0) {
    lines.push("**Age unknown:**");
    for (const u of unknown) {
      lines.push(`  - \`${u.name}\` ${u.current} → ${u.latest}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Cooldown (check once per day) ──────────────────────────────

function getCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg || path.join(os.homedir(), ".cache");
  return path.join(base, "opencode");
}

function shouldCheck(): boolean {
  try {
    const cachePath = path.join(getCacheDir(), COOLDOWN_FILE);
    if (!fs.existsSync(cachePath)) return true;
    const lastCheck = parseInt(fs.readFileSync(cachePath, "utf-8").trim(), 10);
    const hoursSince = (Date.now() - lastCheck) / 3600000;
    return hoursSince >= 24;
  } catch {
    return true;
  }
}

function markChecked(): void {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cacheDir, COOLDOWN_FILE), String(Date.now()));
  } catch {
    // non-critical
  }
}

// ── Plugin Entry Point ─────────────────────────────────────────

const updateGuardPlugin: Plugin = async (input, _options?: PluginOptions) => {
  const { directory } = input;

  const hooks: Hooks = {
    event: async ({ event }) => {
      if (event.type !== "session.created") return;

      // Only check once per day
      if (!shouldCheck()) return;

      const updates = checkForUpdates(directory);
      markChecked();

      if (updates.length === 0) return;

      // Log the report — user can run `bun run update` to install
      const report = buildUpdateReport(updates);
      console.log("\n" + report);

      const mature = updates.filter((u) => isMature(u.ageSeconds));
      if (mature.length > 0) {
        console.log(`Run \`bun run update\` in ${directory} to install mature updates.\n`);
      }
    },
  };

  return hooks;
};

export default updateGuardPlugin;

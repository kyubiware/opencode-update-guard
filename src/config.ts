import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readJsonc } from "./helpers.js";

// ── Configuration ──────────────────────────────────────────────

const DEFAULT_MATURITY_DAYS = 3;
const CONFIG_FILENAME = "update-guard.jsonc";

let maturityDays = DEFAULT_MATURITY_DAYS;
let maturitySecs = maturityDays * 86400;
let debugEnabled = false;

let autoupdateDismissed = false;

export function getMaturityDays(): number {
	return maturityDays;
}

export function getMaturitySecs(): number {
	return maturitySecs;
}

export function isMature(ageSeconds: number): boolean {
	return ageSeconds >= maturitySecs;
}

export function isDebugEnabled(): boolean {
	return debugEnabled;
}

export function getConfigDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg || path.join(os.homedir(), ".config");
	return path.join(base, "opencode");
}

export function loadConfig(): void {
	const configPath = path.join(getConfigDir(), CONFIG_FILENAME);
	const raw = readJsonc(configPath);

	const value = raw?.maturityDays;
	if (typeof value === "number" && value >= 0 && Number.isFinite(value)) {
		maturityDays = value;
	} else {
		maturityDays = DEFAULT_MATURITY_DAYS;
	}
	maturitySecs = maturityDays * 86400;

	const debugValue = raw?.debug;
	if (typeof debugValue === "boolean") {
		debugEnabled = debugValue;
	} else {
		debugEnabled = false;
	}

	const dismissedValue = raw?.autoupdateDismissed;
	if (typeof dismissedValue === "boolean") {
		autoupdateDismissed = dismissedValue;
	} else {
		autoupdateDismissed = false;
	}
}

export function isAutoupdateDismissed(): boolean {
	return autoupdateDismissed;
}

export function markAutoupdateDismissed(): void {
	try {
		const configPath = path.join(getConfigDir(), CONFIG_FILENAME);
		const obj = readJsonc(configPath);
		if (obj && typeof obj === "object") {
			obj.autoupdateDismissed = true;
			fs.writeFileSync(configPath, `${JSON.stringify(obj, null, 2)}\n`);
			autoupdateDismissed = true;
		}
	} catch {
		// non-critical — user can dismiss again later
	}
}

export function ensureConfigFile(): void {
	try {
		const configDir = getConfigDir();
		const configPath = path.join(configDir, CONFIG_FILENAME);

		if (fs.existsSync(configPath)) return;

		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}

		const content = `{
  // "$schema": "https://github.com/kyubiware/opencode-update-guard/raw/main/update-guard.schema.json",

  // Minimum age (in days) a package version must be before it's considered
  // "mature" enough to install. This cooldown helps protect against supply
  // chain attacks on newly published packages.
  "maturityDays": ${DEFAULT_MATURITY_DAYS},

  // Enable debug logging to diagnose update guard issues.
  // Logs are written to $XDG_CACHE_HOME/opencode/update-guard-debug.log
  "debug": false
}
`;
		fs.writeFileSync(configPath, content);
	} catch {
		// non-critical — will use defaults
	}
}

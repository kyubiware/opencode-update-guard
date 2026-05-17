import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getMaturitySecs } from "./config.js";
import type { UpdateInfo } from "./types.js";

const COOLDOWN_FILE = "update-guard-last-check";
const CONFIG_FILENAME = "update-guard.jsonc";

function getCacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	const base = xdg || path.join(os.homedir(), ".cache");
	return path.join(base, "opencode");
}

function getConfigDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg || path.join(os.homedir(), ".config");
	return path.join(base, "opencode");
}

function readPackageVersion(): string {
	try {
		const pkgPath = path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"..",
			"package.json",
		);
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
			version: string;
		};
		return pkg.version;
	} catch {
		return "unknown";
	}
}

export function computeFingerprint(
	configDir: string,
	pluginVersion: string,
): string {
	const configPath = path.join(configDir, CONFIG_FILENAME);
	let configContent = "";
	try {
		if (fs.existsSync(configPath)) {
			configContent = fs.readFileSync(configPath, "utf-8");
		}
	} catch {
		// non-critical
	}
	return createHash("sha256")
		.update(`${configContent}|${pluginVersion}`)
		.digest("hex");
}

function getCurrentFingerprint(pluginVersion: string): string {
	return computeFingerprint(getConfigDir(), pluginVersion);
}

export function shouldCheck(pluginVersion?: string): boolean {
	const version = pluginVersion || readPackageVersion();
	try {
		const cachePath = path.join(getCacheDir(), COOLDOWN_FILE);
		if (!fs.existsSync(cachePath)) return true;

		const raw = fs.readFileSync(cachePath, "utf-8").trim();

		// Backwards compatibility: old format was a plain number
		const oldFormat = parseInt(raw, 10);
		if (!Number.isNaN(oldFormat) && String(oldFormat) === raw) {
			return true;
		}

		const cache = JSON.parse(raw) as {
			timestamp: number;
			fingerprint: string;
		};
		if (
			typeof cache.timestamp !== "number" ||
			typeof cache.fingerprint !== "string"
		) {
			return true;
		}

		const currentFingerprint = getCurrentFingerprint(version);
		if (cache.fingerprint !== currentFingerprint) {
			return true;
		}

		const hoursSince = (Date.now() - cache.timestamp) / 3600000;
		return hoursSince >= 24;
	} catch {
		return true;
	}
}

export function markChecked(
	pluginVersion?: string,
	updates?: UpdateInfo[],
): void {
	const version = pluginVersion || readPackageVersion();
	try {
		const cacheDir = getCacheDir();
		if (!fs.existsSync(cacheDir)) {
			fs.mkdirSync(cacheDir, { recursive: true });
		}

		const fingerprint = getCurrentFingerprint(version);
		const cache: {
			timestamp: number;
			fingerprint: string;
			updates?: {
				name: string;
				current: string;
				latest: string;
				ageSeconds: number;
				mature: boolean;
			}[];
		} = {
			timestamp: Date.now(),
			fingerprint,
		};

		if (updates && updates.length > 0) {
			cache.updates = updates.map((u) => ({
				name: u.name,
				current: u.current,
				latest: u.latest,
				ageSeconds: u.ageSeconds,
				mature: u.ageSeconds >= getMaturitySecs(),
			}));
		}

		fs.writeFileSync(path.join(cacheDir, COOLDOWN_FILE), JSON.stringify(cache));
	} catch {
		// non-critical
	}
}

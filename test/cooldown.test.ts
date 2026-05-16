import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	computeFingerprint,
	markChecked,
	shouldCheck,
} from "../src/cooldown.js";

let tmpCacheDir: string;
let tmpConfigDir: string;
let originalCacheHome: string | undefined;
let originalConfigHome: string | undefined;

const PLUGIN_VERSION = "0.1.4";

function getCacheFilePath(): string {
	return path.join(tmpCacheDir, "opencode", "update-guard-last-check");
}

function getConfigFilePath(): string {
	return path.join(tmpConfigDir, "opencode", "update-guard.jsonc");
}

function getTestConfigDir(): string {
	return path.join(tmpConfigDir, "opencode");
}

function writeConfig(content: string): void {
	const configPath = getConfigFilePath();
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, content);
}

function writeCache(content: string): void {
	const cachePath = getCacheFilePath();
	fs.mkdirSync(path.dirname(cachePath), { recursive: true });
	fs.writeFileSync(cachePath, content);
}

function readCache(): string {
	return fs.readFileSync(getCacheFilePath(), "utf-8");
}

function expectedFingerprint(configContent: string, version: string): string {
	return createHash("sha256")
		.update(configContent + "|" + version)
		.digest("hex");
}

beforeEach(() => {
	originalCacheHome = process.env.XDG_CACHE_HOME;
	originalConfigHome = process.env.XDG_CONFIG_HOME;
	tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-cache-"));
	tmpConfigDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "update-guard-config-"),
	);
	process.env.XDG_CACHE_HOME = tmpCacheDir;
	process.env.XDG_CONFIG_HOME = tmpConfigDir;
});

afterEach(() => {
	process.env.XDG_CACHE_HOME = originalCacheHome;
	process.env.XDG_CONFIG_HOME = originalConfigHome;
	fs.rmSync(tmpCacheDir, { recursive: true, force: true });
	fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

describe("shouldCheck", () => {
	it("returns true when no cache file exists", () => {
		expect(shouldCheck(PLUGIN_VERSION)).toBe(true);
	});

	it("returns true for old format (plain number)", () => {
		writeCache(String(Date.now()));
		expect(shouldCheck(PLUGIN_VERSION)).toBe(true);
	});

	it("returns false when same fingerprint and within 24h", () => {
		writeConfig('{"maturityDays": 3}');
		const fp = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		const timestamp = Date.now();
		writeCache(JSON.stringify({ timestamp, fingerprint: fp }));
		expect(shouldCheck(PLUGIN_VERSION)).toBe(false);
	});

	it("returns true when same fingerprint but past 24h", () => {
		writeConfig('{"maturityDays": 3}');
		const fp = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		const timestamp = Date.now() - 25 * 3600_000;
		writeCache(JSON.stringify({ timestamp, fingerprint: fp }));
		expect(shouldCheck(PLUGIN_VERSION)).toBe(true);
	});

	it("returns true when config content differs (even within 24h)", () => {
		writeConfig('{"maturityDays": 3}');
		const fp = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		const timestamp = Date.now();
		writeCache(JSON.stringify({ timestamp, fingerprint: fp }));

		// Change config after fingerprint was stored
		writeConfig('{"maturityDays": 5}');
		expect(shouldCheck(PLUGIN_VERSION)).toBe(true);
	});

	it("returns true when plugin version differs (even within 24h)", () => {
		writeConfig('{"maturityDays": 3}');
		const fp = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		const timestamp = Date.now();
		writeCache(JSON.stringify({ timestamp, fingerprint: fp }));

		expect(shouldCheck("0.1.5")).toBe(true);
	});
});

describe("markChecked", () => {
	it("stores timestamp and fingerprint in new JSON format", () => {
		const configContent = '{"maturityDays": 3}';
		writeConfig(configContent);
		markChecked(PLUGIN_VERSION);

		const cacheRaw = readCache();
		const cache = JSON.parse(cacheRaw) as {
			timestamp: number;
			fingerprint: string;
		};
		expect(typeof cache.timestamp).toBe("number");
		expect(cache.fingerprint).toBe(
			expectedFingerprint(configContent, PLUGIN_VERSION),
		);
	});
});

describe("computeFingerprint", () => {
	it("returns same hash for same inputs", () => {
		writeConfig('{"maturityDays": 3}');
		const fp1 = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		const fp2 = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		expect(fp1).toBe(fp2);
	});

	it("returns different hash for different config content", () => {
		writeConfig('{"maturityDays": 3}');
		const fp1 = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		writeConfig('{"maturityDays": 5}');
		const fp2 = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		expect(fp1).not.toBe(fp2);
	});

	it("returns different hash for different plugin version", () => {
		writeConfig('{"maturityDays": 3}');
		const fp1 = computeFingerprint(getTestConfigDir(), "0.1.4");
		const fp2 = computeFingerprint(getTestConfigDir(), "0.1.5");
		expect(fp1).not.toBe(fp2);
	});

	it("returns consistent hash when config file is missing (empty content)", () => {
		const fp1 = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		const fp2 = computeFingerprint(getTestConfigDir(), PLUGIN_VERSION);
		expect(fp1).toBe(fp2);
		expect(fp1).toBe(expectedFingerprint("", PLUGIN_VERSION));
	});
});

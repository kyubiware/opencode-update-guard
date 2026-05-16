/**
 * Tests for src/debug.ts — configurable debug logging
 *
 * Verifies that debugLog respects the isDebugEnabled() config flag,
 * writes timestamped lines to the correct log file, and handles errors
 * gracefully.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
	isDebugEnabled: vi.fn(() => false),
}));

import { isDebugEnabled } from "../src/config.js";
import { debugLog, getDebugLogPath } from "../src/debug.js";

let tmpDir: string;
let originalXdgCacheHome: string | undefined;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-debug-test-"));
	originalXdgCacheHome = process.env.XDG_CACHE_HOME;
	process.env.XDG_CACHE_HOME = tmpDir;
	vi.clearAllMocks();
});

afterEach(() => {
	process.env.XDG_CACHE_HOME = originalXdgCacheHome;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("debugLog", () => {
	it("should not write to file when debug is disabled", () => {
		vi.mocked(isDebugEnabled).mockReturnValue(false);
		debugLog("test message");
		const logPath = getDebugLogPath();
		expect(fs.existsSync(logPath)).toBe(false);
	});

	it("should write to file with timestamp when debug is enabled", () => {
		vi.mocked(isDebugEnabled).mockReturnValue(true);
		debugLog("test message");
		const logPath = getDebugLogPath();
		expect(fs.existsSync(logPath)).toBe(true);
		const content = fs.readFileSync(logPath, "utf-8");
		expect(content).toMatch(
			/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] test message\n$/,
		);
	});

	it("should append multiple calls", () => {
		vi.mocked(isDebugEnabled).mockReturnValue(true);
		debugLog("first");
		debugLog("second");
		const logPath = getDebugLogPath();
		const content = fs.readFileSync(logPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(/^\[.*\] first$/);
		expect(lines[1]).toMatch(/^\[.*\] second$/);
	});

	it("should silently catch write errors", () => {
		vi.mocked(isDebugEnabled).mockReturnValue(true);
		process.env.XDG_CACHE_HOME = path.join(tmpDir, "nonexistent", "nested");
		expect(() => debugLog("should not crash")).not.toThrow();
	});
});

describe("getDebugLogPath", () => {
	it("should return path based on XDG_CACHE_HOME", () => {
		const expected = path.join(tmpDir, "opencode", "update-guard-debug.log");
		expect(getDebugLogPath()).toBe(expected);
	});

	it("should fallback to ~/.cache when XDG_CACHE_HOME is not set", () => {
		delete process.env.XDG_CACHE_HOME;
		const expected = path.join(
			os.homedir(),
			".cache",
			"opencode",
			"update-guard-debug.log",
		);
		expect(getDebugLogPath()).toBe(expected);
	});
});

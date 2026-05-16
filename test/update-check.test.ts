/**
 * Tests for src/update-check.ts — findBestUpdate and checkForUpdates
 *
 * Mocks all npm and fs calls to avoid real network / disk access.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { findBestUpdate, checkForUpdates } from "../src/update-check.js";

vi.mock("../src/helpers.js", () => ({
	execQuiet: vi.fn(),
	getPublishedTimes: vi.fn(),
	readJsonc: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
}));

import * as helpers from "../src/helpers.js";
import * as fs from "node:fs";

const mockedHelpers = vi.mocked(helpers);
const mockedFs = vi.mocked(fs);

describe("findBestUpdate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports latest when it's the only newer version and it's mature", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": now - maturitySecs - 1,
			"1.1.0": now - maturitySecs - 1,
		});

		const result = findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.1.0",
			ageSeconds: maturitySecs + 1,
		});
	});

	it("reports intermediate mature version when latest is immature", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": now - maturitySecs * 3,
			"1.1.0": now - maturitySecs * 2,
			"1.2.0": now - maturitySecs / 2,
		});

		const result = findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.1.0",
			ageSeconds: maturitySecs * 2,
		});
	});

	it("reports latest as immature when no intermediate is mature", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": now - 50_000,
			"1.1.0": now - 25_000,
		});

		const result = findBestUpdate("pkg", "0.9.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.1.0",
			ageSeconds: 25_000,
		});
	});

	it("finds highest mature version among multiple intermediates", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": now - maturitySecs * 5,
			"1.1.0": now - maturitySecs * 3,
			"1.2.0": now - maturitySecs * 2,
			"1.3.0": now - 50_000,
		});

		const result = findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.2.0",
			ageSeconds: maturitySecs * 2,
		});
	});

	it("returns null when no newer versions exist", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": now - maturitySecs * 2,
		});

		const result = findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toBeNull();
	});

	it("returns null when current equals absolute latest", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": now - maturitySecs * 2,
		});

		const result = findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toBeNull();
	});

	it("handles versions with different segment counts correctly", () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0": now - maturitySecs * 2,
			"1.0.1": now - maturitySecs * 2,
		});

		const result = findBestUpdate("pkg", "1.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.0.1",
			ageSeconds: maturitySecs * 2,
		});
	});

	it("returns null when getPublishedTimes returns null", () => {
		mockedHelpers.getPublishedTimes.mockReturnValue(null);

		const result = findBestUpdate("pkg", "1.0.0", 1_000_000, 100_000);
		expect(result).toBeNull();
	});
});

describe("checkForUpdates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns CLI update when a newer mature version exists", () => {
		mockedHelpers.execQuiet.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return "1.0.0";
			return "";
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": 900_000,
			"1.1.0": 999_000,
		});

		const updates = checkForUpdates("/fake/dir");
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "cli",
			name: "opencode",
			current: "1.0.0",
			latest: "1.1.0",
			ageSeconds: 1_000,
		});
	});

	it("returns package updates from package.json dependencies", () => {
		mockedHelpers.execQuiet.mockReturnValue("");
		mockedHelpers.readJsonc.mockImplementation((filePath: string) => {
			if (filePath.endsWith("package.json")) {
				return { dependencies: { "my-pkg": "^1.0.0" } };
			}
			return null;
		});
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": 900_000,
			"1.1.0": 999_000,
		});

		const updates = checkForUpdates("/fake/dir");
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "pkg",
			name: "my-pkg",
			current: "1.0.0",
			latest: "1.1.0",
		});
	});

	it("returns plugin updates from global opencode config, not project dir", () => {
		mockedHelpers.execQuiet.mockReturnValue("");
		mockedHelpers.readJsonc.mockImplementation((filePath: string) => {
			// Plugin refs come from the global config dir, NOT the project dir
			if (filePath.includes("opencode") && filePath.endsWith("opencode.json")) {
				return { plugin: ["my-plugin@1.0.0"] };
			}
			return null;
		});
		mockedFs.existsSync.mockReturnValue(true);
		mockedHelpers.getPublishedTimes.mockReturnValue({
			"1.0.0": 900_000,
			"1.1.0": 999_000,
		});

		const updates = checkForUpdates("/fake/project/dir");
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "plugin",
			name: "my-plugin",
			current: "1.0.0",
			latest: "1.1.0",
		});
		// Verify that readJsonc was NOT called with the project dir path for plugins
		const readCalls = mockedHelpers.readJsonc.mock.calls.map(
			(c) => c[0] as string,
		);
		const projectDirCall = readCalls.find(
			(p) => p.startsWith("/fake/project/dir") && !p.endsWith("package.json"),
		);
		expect(projectDirCall).toBeUndefined();
	});
});

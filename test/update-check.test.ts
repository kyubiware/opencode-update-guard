/**
 * Tests for src/update-check.ts — findBestUpdate and checkForUpdates
 *
 * Mocks all npm and fs calls to avoid real network / disk access.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { findBestUpdate, checkForUpdates } from "../src/update-check.js";

vi.mock("../src/helpers.js", () => ({
	execQuietAsync: vi.fn(),
	getPublishedTimesAsync: vi.fn(),
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

	it("reports latest when it's the only newer version and it's mature", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": now - maturitySecs - 1,
			"1.1.0": now - maturitySecs - 1,
		});

		const result = await findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.1.0",
			ageSeconds: maturitySecs + 1,
		});
	});

	it("reports intermediate mature version when latest is immature", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": now - maturitySecs * 3,
			"1.1.0": now - maturitySecs * 2,
			"1.2.0": now - maturitySecs / 2,
		});

		const result = await findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.1.0",
			ageSeconds: maturitySecs * 2,
		});
	});

	it("reports latest as immature when no intermediate is mature", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": now - 50_000,
			"1.1.0": now - 25_000,
		});

		const result = await findBestUpdate("pkg", "0.9.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.1.0",
			ageSeconds: 25_000,
		});
	});

	it("finds highest mature version among multiple intermediates", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": now - maturitySecs * 5,
			"1.1.0": now - maturitySecs * 3,
			"1.2.0": now - maturitySecs * 2,
			"1.3.0": now - 50_000,
		});

		const result = await findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.2.0",
			ageSeconds: maturitySecs * 2,
		});
	});

	it("returns null when no newer versions exist", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": now - maturitySecs * 2,
		});

		const result = await findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toBeNull();
	});

	it("returns null when current equals absolute latest", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": now - maturitySecs * 2,
		});

		const result = await findBestUpdate("pkg", "1.0.0", now, maturitySecs);
		expect(result).toBeNull();
	});

	it("handles versions with different segment counts correctly", async () => {
		const now = 1_000_000;
		const maturitySecs = 100_000;
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0": now - maturitySecs * 2,
			"1.0.1": now - maturitySecs * 2,
		});

		const result = await findBestUpdate("pkg", "1.0", now, maturitySecs);
		expect(result).toEqual({
			version: "1.0.1",
			ageSeconds: maturitySecs * 2,
		});
	});

	it("returns null when getPublishedTimesAsync returns null", async () => {
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue(null);

		const result = await findBestUpdate("pkg", "1.0.0", 1_000_000, 100_000);
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

	it("returns CLI update when a newer mature version exists", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("1.0.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 900_000,
			"1.1.0": 999_000,
		});

		const updates = await checkForUpdates();
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "cli",
			name: "opencode",
			current: "1.0.0",
			latest: "1.1.0",
			ageSeconds: 1_000,
		});
	});

	it("should NOT check project package.json dependencies", async () => {
		mockedHelpers.execQuietAsync.mockResolvedValue("");
		mockedHelpers.readJsonc.mockImplementation((filePath: string) => {
			if (filePath.endsWith("package.json")) {
				return { dependencies: { "my-pkg": "^1.0.0" } };
			}
			return null;
		});
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 900_000,
			"1.1.0": 999_000,
		});

		const updates = await checkForUpdates();

		// Project-level deps should NOT appear in results
		const pkgNames = updates.map((u) => u.name);
		expect(pkgNames).not.toContain("my-pkg");
		expect(updates.every((u) => u.type !== "pkg")).toBe(true);
	});

	it("returns plugin updates from global opencode config, not project dir", async () => {
		mockedHelpers.execQuietAsync.mockResolvedValue("");
		mockedHelpers.readJsonc.mockImplementation((filePath: string) => {
			// Plugin refs come from the global config dir, NOT the project dir
			if (filePath.includes("opencode") && filePath.endsWith("opencode.json")) {
				return { plugin: ["my-plugin@1.0.0"] };
			}
			return null;
		});
		mockedFs.existsSync.mockReturnValue(true);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 900_000,
			"1.1.0": 999_000,
		});

		const updates = await checkForUpdates();
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

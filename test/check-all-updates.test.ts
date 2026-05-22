/**
 * Tests for src/update-check.ts — checkAllUpdates
 *
 * Mocks all npm and fs calls to avoid real network / disk access.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkAllUpdates } from "../src/update-check.js";

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

describe("checkAllUpdates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns all newer versions sorted descending by semver", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("1.0.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 900_000,
			"1.1.0": 950_000,
			"1.2.0": 990_000,
		});

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "cli",
			name: "opencode",
			current: "1.0.0",
		});
		expect(updates[0].versions).toEqual([
			{ version: "1.2.0", ageSeconds: 10_000 },
			{ version: "1.1.0", ageSeconds: 50_000 },
		]);
	});

	it("calculates correct ageSeconds for each version", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("1.0.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 800_000,
			"1.1.0": 900_000,
			"1.2.0": 950_000,
		});

		const updates = await checkAllUpdates();
		expect(updates[0].versions).toEqual([
			{ version: "1.2.0", ageSeconds: 50_000 },
			{ version: "1.1.0", ageSeconds: 100_000 },
		]);
	});

	it("returns empty array when no newer versions exist", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("1.0.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 900_000,
		});

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(0);
	});

	it("returns empty array when getPublishedTimesAsync returns null", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("1.0.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue(null);

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(0);
	});

	it("handles scoped packages (@scope/pkg)", async () => {
		mockedHelpers.execQuietAsync.mockResolvedValue("");
		mockedHelpers.readJsonc.mockImplementation((filePath: string) => {
			if (
				filePath.includes("opencode") &&
				filePath.endsWith("opencode.json")
			) {
				return { plugin: ["@scope/pkg@1.0.0"] };
			}
			return null;
		});
		mockedFs.existsSync.mockReturnValue(true);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"1.0.0": 900_000,
			"1.1.0": 950_000,
		});

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "plugin",
			name: "@scope/pkg",
			current: "1.0.0",
		});
		expect(updates[0].versions).toEqual([
			{ version: "1.1.0", ageSeconds: 50_000 },
		]);
	});

	it("handles versions with different segment counts (e.g., '2.0' vs '2.0.1')", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("2.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);
		mockedHelpers.getPublishedTimesAsync.mockResolvedValue({
			"2.0": 900_000,
			"2.0.1": 950_000,
			"2.1.0": 990_000,
		});

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(1);
		expect(updates[0].versions).toEqual([
			{ version: "2.1.0", ageSeconds: 10_000 },
			{ version: "2.0.1", ageSeconds: 50_000 },
		]);
	});

	it("returns empty array when CLI version command returns empty", async () => {
		mockedHelpers.execQuietAsync.mockResolvedValue("");
		mockedHelpers.readJsonc.mockReturnValue(null);
		mockedFs.existsSync.mockReturnValue(false);

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(0);
	});

	it("returns both CLI and plugin updates when both have newer versions", async () => {
		mockedHelpers.execQuietAsync.mockImplementation((cmd: string) => {
			if (cmd === "opencode --version") return Promise.resolve("1.0.0");
			return Promise.resolve("");
		});
		mockedHelpers.readJsonc.mockImplementation((filePath: string) => {
			if (
				filePath.includes("opencode") &&
				filePath.endsWith("opencode.json")
			) {
				return { plugin: ["my-plugin@1.0.0"] };
			}
			return null;
		});
		mockedFs.existsSync.mockReturnValue(true);
		mockedHelpers.getPublishedTimesAsync.mockImplementation((pkg: string) => {
			if (pkg === "opencode-ai") {
				return Promise.resolve({
					"1.0.0": 900_000,
					"1.1.0": 950_000,
				});
			}
			if (pkg === "my-plugin") {
				return Promise.resolve({
					"1.0.0": 800_000,
					"1.1.0": 850_000,
					"1.2.0": 900_000,
				});
			}
			return Promise.resolve(null);
		});

		const updates = await checkAllUpdates();
		expect(updates).toHaveLength(2);

		const cliUpdate = updates.find((u) => u.type === "cli");
		expect(cliUpdate).toBeDefined();
		expect(cliUpdate!.versions).toEqual([
			{ version: "1.1.0", ageSeconds: 50_000 },
		]);

		const pluginUpdate = updates.find((u) => u.type === "plugin");
		expect(pluginUpdate).toBeDefined();
		expect(pluginUpdate!.versions).toEqual([
			{ version: "1.2.0", ageSeconds: 100_000 },
			{ version: "1.1.0", ageSeconds: 150_000 },
		]);
	});
});

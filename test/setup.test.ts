/**
 * TDD tests for runtime startup checks (src/setup.ts)
 *
 * Tests: checkAutoupdateDisabled, disableAutoupdate, runStartupChecks
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mock all external dependencies ────────────────────────────

vi.mock("@clack/prompts", () => ({
	confirm: vi.fn(),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("../src/config.js", () => ({
	getConfigDir: vi.fn(() => "/mock/config/dir"),
	loadConfig: vi.fn(),
}));

vi.mock("../src/helpers.js", () => ({
	readJsonc: vi.fn(() => null),
}));

vi.mock("../src/shell.js", () => ({
	detectShell: vi.fn(() => null),
	isHookInstalled: vi.fn(() => false),
	installHook: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	readFileSync: vi.fn(() => "{}"),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
}));

vi.mock("node:path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
}));

// ── Imports (resolved after mocks are hoisted) ────────────────

import * as clack from "@clack/prompts";
import { readJsonc } from "../src/helpers.js";
import { detectShell, isHookInstalled, installHook } from "../src/shell.js";
import { writeFileSync, mkdirSync } from "node:fs";
import {
	checkAutoupdateDisabled,
	disableAutoupdate,
	runStartupChecks,
} from "../src/setup.js";

// ── Typed mock helpers ────────────────────────────────────────

const mockedConfirm = vi.mocked(clack.confirm);
const mockedIsCancel = vi.mocked(clack.isCancel);
const mockedReadJsonc = vi.mocked(readJsonc);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedDetectShell = vi.mocked(detectShell);
const mockedIsHookInstalled = vi.mocked(isHookInstalled);
const mockedInstallHook = vi.mocked(installHook);

// ── checkAutoupdateDisabled ───────────────────────────────────

describe("checkAutoupdateDisabled", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return true when opencode.json has autoupdate: false", () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: false });
		expect(checkAutoupdateDisabled()).toBe(true);
	});

	it("should return false when opencode.json has autoupdate: true", () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: true });
		expect(checkAutoupdateDisabled()).toBe(false);
	});

	it("should return false when autoupdate field is absent", () => {
		mockedReadJsonc.mockReturnValue({ someField: "value" });
		expect(checkAutoupdateDisabled()).toBe(false);
	});

	it("should return false when no config file exists", () => {
		mockedReadJsonc.mockReturnValue(null);
		expect(checkAutoupdateDisabled()).toBe(false);
	});
});

// ── disableAutoupdate ─────────────────────────────────────────

describe("disableAutoupdate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should write autoupdate:false to existing opencode.json, preserving other fields", () => {
		mockedReadJsonc.mockReturnValue({ existingField: "keep-me" });

		disableAutoupdate();

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const [path, data] = mockedWriteFileSync.mock.calls[0];
		expect(path).toContain("opencode.json");
		expect(data).toContain('"existingField"');
		expect(data).toContain('"autoupdate": false');
	});

	it("should create new opencode.json with autoupdate:false when no config exists", () => {
		mockedReadJsonc.mockReturnValue(null);

		disableAutoupdate();

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const [, data] = mockedWriteFileSync.mock.calls[0];
		const parsed = JSON.parse(data);
		expect(parsed).toEqual({ autoupdate: false });
	});

	it("should handle JSONC format by falling back to opencode.jsonc", () => {
		mockedReadJsonc
			.mockReturnValueOnce(null) // opencode.json → null
			.mockReturnValueOnce({ someField: "value" }); // opencode.jsonc → found

		disableAutoupdate();

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const [path, data] = mockedWriteFileSync.mock.calls[0];
		expect(path).toContain("opencode.jsonc");
		expect(data).toContain('"someField"');
		expect(data).toContain('"autoupdate": false');
	});

	it("should create parent directories when needed", () => {
		mockedReadJsonc.mockReturnValue(null);

		disableAutoupdate();

		expect(mockedMkdirSync).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ recursive: true }),
		);
	});
});

// ── runStartupChecks ─────────────────────────────────────────

describe("runStartupChecks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset default implementations (clearAllMocks only resets call counts)
		mockedIsCancel.mockReturnValue(false);
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
	});

	it("should resolve without prompting when autoupdate is false AND hook is installed", async () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: false });
		mockedDetectShell.mockReturnValue({ type: "bash", configPath: "/home/user/.bashrc" });
		mockedIsHookInstalled.mockReturnValue(true);

		await runStartupChecks();

		expect(mockedConfirm).not.toHaveBeenCalled();
	});

	it("should prompt user when autoupdate is true; on yes call disableAutoupdate", async () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: true });
		mockedDetectShell.mockReturnValue({ type: "bash", configPath: "/home/user/.bashrc" });
		mockedIsHookInstalled.mockReturnValue(true);
		mockedConfirm.mockResolvedValue(true);

		await runStartupChecks();

		expect(mockedConfirm).toHaveBeenCalledTimes(1);
		expect(mockedWriteFileSync).toHaveBeenCalled();
	});

	it("should prompt user when hook is missing; on yes call installHook", async () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: false });
		mockedDetectShell.mockReturnValue({ type: "bash", configPath: "/home/user/.bashrc" });
		mockedIsHookInstalled.mockReturnValue(false);
		mockedConfirm.mockResolvedValue(true);

		await runStartupChecks();

		expect(mockedConfirm).toHaveBeenCalledTimes(1);
		expect(mockedInstallHook).toHaveBeenCalledTimes(1);
	});

	it("should resolve silently when !process.stdin.isTTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: undefined,
			configurable: true,
		});

		await runStartupChecks();

		expect(mockedConfirm).not.toHaveBeenCalled();
	});

	it("should resolve silently when skipPrompts: true", async () => {
		await runStartupChecks({ skipPrompts: true });

		expect(mockedConfirm).not.toHaveBeenCalled();
	});

	it("should skip gracefully when user cancels autoupdate prompt", async () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: true });
		mockedDetectShell.mockReturnValue({ type: "bash", configPath: "/home/user/.bashrc" });
		mockedIsHookInstalled.mockReturnValue(true);
		mockedConfirm.mockResolvedValue(Symbol("cancel"));
		mockedIsCancel.mockReturnValue(true);

		await expect(runStartupChecks()).resolves.toBeUndefined();
		expect(mockedWriteFileSync).not.toHaveBeenCalled();
	});

	it("should skip gracefully when user cancels shell hook prompt", async () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: false });
		mockedDetectShell.mockReturnValue({ type: "bash", configPath: "/home/user/.bashrc" });
		mockedIsHookInstalled.mockReturnValue(false);
		mockedConfirm.mockResolvedValue(Symbol("cancel"));
		mockedIsCancel.mockReturnValue(true);

		await expect(runStartupChecks()).resolves.toBeUndefined();
		expect(mockedInstallHook).not.toHaveBeenCalled();
	});

	it("should run both checks independently when both need attention", async () => {
		mockedReadJsonc.mockReturnValue({ autoupdate: true });
		mockedDetectShell.mockReturnValue({ type: "bash", configPath: "/home/user/.bashrc" });
		mockedIsHookInstalled.mockReturnValue(false);
		mockedConfirm.mockResolvedValue(true);

		await runStartupChecks();

		expect(mockedConfirm).toHaveBeenCalledTimes(2);
		expect(mockedWriteFileSync).toHaveBeenCalled();
		expect(mockedInstallHook).toHaveBeenCalledTimes(1);
	});
});

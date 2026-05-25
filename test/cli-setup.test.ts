/**
 * RED: Tests for CLI setup flow and --uninstall-hook flag.
 *
 * All tests are expected to FAIL because main (as exported function) and
 * handleUninstallHook are not yet exported from src/cli.ts.
 * When Task 4 implements these exports, the imports will resolve and the
 * tests should pass (GREEN).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mock @clack/prompts ─────────────────────────────────────────
const mockSpinnerInstance = {
	start: vi.fn(),
	stop: vi.fn(),
	message: vi.fn(),
};

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => mockSpinnerInstance),
	log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() },
	note: vi.fn(),
	confirm: vi.fn(),
	select: vi.fn(),
	multiselect: vi.fn(),
	isCancel: vi.fn(() => false),
	cancel: vi.fn(),
}));

// ── Mock src/config.js ───────────────────────────────────────────
vi.mock("../src/config.js", () => ({
	loadConfig: vi.fn(),
	getMaturitySecs: vi.fn(() => 86400 * 3),
	getMaturityDays: vi.fn(() => 3),
	isMature: vi.fn((age: number) => age >= 86400 * 3),
	getConfigDir: vi.fn(() => "/mock/config/dir"),
}));

// ── Mock src/update-check.js ─────────────────────────────────────
vi.mock("../src/update-check.js", () => ({
	checkAllUpdates: vi.fn(),
}));

// ── Mock src/helpers.js ──────────────────────────────────────────
vi.mock("../src/helpers.js", () => ({
	formatAge: vi.fn((age: number) => {
		const days = Math.floor(age / 86400);
		const hours = Math.floor((age % 86400) / 3600);
		return `${days}d ${hours}h`;
	}),
}));

// ── Mock src/shell.js (Task 1, parallel) ─────────────────────────
vi.mock("../src/shell.js", () => ({
	detectShell: vi.fn(),
	isHookInstalled: vi.fn(),
	installHook: vi.fn(),
	uninstallHook: vi.fn(),
}));

// ── Mock src/setup.js (Task 2, parallel) ─────────────────────────
vi.mock("../src/setup.js", () => ({
	runStartupChecks: vi.fn(),
}));

// ── Mock node:child_process ──────────────────────────────────────
vi.mock("node:child_process", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execSync: vi.fn(() => ""),
		exec: vi.fn(
			(_cmd: string, _opts: unknown, cb?: Function) => {
				const callback = typeof _opts === "function" ? _opts : cb;
				if (callback)
					process.nextTick(() =>
						callback(null, { stdout: "" }),
					);
			},
		),
	};
});

// ── Mock node:fs ─────────────────────────────────────────────────
vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	readFileSync: vi.fn(() => JSON.stringify({ plugin: [] })),
	writeFileSync: vi.fn(),
	realpathSync: vi.fn((p: string) => p),
}));

// ── Mock node:path ───────────────────────────────────────────────
vi.mock("node:path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
}));

// ── Imports (post-mock hoisting) ─────────────────────────────────
import * as clack from "@clack/prompts";
import { checkAllUpdates } from "../src/update-check.js";
import { runStartupChecks } from "../src/setup.js";
import { detectShell, isHookInstalled, uninstallHook } from "../src/shell.js";
// These imports will FAIL because the functions don't exist yet in src/cli.ts.
// This is the RED phase — the entire test file will fail at module load time.
import { main, handleUninstallHook } from "../src/cli.js";

const mockedLog = vi.mocked(clack.log);
const mockedCheckAllUpdates = vi.mocked(checkAllUpdates);
const mockedRunStartupChecks = vi.mocked(runStartupChecks);
const mockedDetectShell = vi.mocked(detectShell);
const mockedIsHookInstalled = vi.mocked(isHookInstalled);
const mockedUninstallHook = vi.mocked(uninstallHook);

// ── Tests ────────────────────────────────────────────────────────
describe("main startup checks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedCheckAllUpdates.mockResolvedValue([]);
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
	});

	it("should call runStartupChecks before update flow when no flags", async () => {
		await main();

		expect(mockedRunStartupChecks).toHaveBeenCalled();
		expect(mockedCheckAllUpdates).toHaveBeenCalled();
		// startup checks should happen before update check
		const startupOrder =
			mockedRunStartupChecks.mock.invocationCallOrder[0];
		const checkOrder =
			mockedCheckAllUpdates.mock.invocationCallOrder[0];
		expect(startupOrder).toBeLessThan(checkOrder);
	});

	it("should skip runStartupChecks when --all flag is set", async () => {
		// With --all, startup checks are bypassed — proceed directly to update flow
		// Implementation reads process.argv at module level, so this tests
		// that main() respects the flag via internal logic.
		// This test may need adjustment after Task 4 implementation.
		await main({ skipStartupChecks: true });

		expect(mockedRunStartupChecks).not.toHaveBeenCalled();
		expect(mockedCheckAllUpdates).toHaveBeenCalled();
	});
});

describe("handleUninstallHook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should detect shell, call uninstallHook, and print confirmation", async () => {
		mockedDetectShell.mockReturnValue({
			type: "zsh",
			configPath: "/home/user/.zshrc",
		});
		mockedIsHookInstalled.mockReturnValue(true);

		await handleUninstallHook();

		expect(mockedDetectShell).toHaveBeenCalled();
		expect(mockedIsHookInstalled).toHaveBeenCalledWith(
			"zsh",
			"/home/user/.zshrc",
		);
		expect(mockedUninstallHook).toHaveBeenCalledWith(
			"zsh",
			"/home/user/.zshrc",
		);
		expect(mockedLog.success).toHaveBeenCalled();
	});

	it("should print 'not installed' message when hook is not installed", async () => {
		mockedDetectShell.mockReturnValue({
			type: "bash",
			configPath: "/home/user/.bashrc",
		});
		mockedIsHookInstalled.mockReturnValue(false);

		await handleUninstallHook();

		expect(mockedUninstallHook).not.toHaveBeenCalled();
		expect(mockedLog.info).toHaveBeenCalled();
	});

	it("should print 'unsupported shell' message when shell cannot be detected", async () => {
		mockedDetectShell.mockReturnValue(null);

		await handleUninstallHook();

		expect(mockedIsHookInstalled).not.toHaveBeenCalled();
		expect(mockedUninstallHook).not.toHaveBeenCalled();
		expect(mockedLog.warn).toHaveBeenCalled();
	});
});

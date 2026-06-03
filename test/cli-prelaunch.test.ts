/**
 * RED: Tests for CLI --pre-launch flow.
 *
 * All tests are expected to FAIL because runPreLaunch and
 * selectVersionsPreLaunch are not yet exported from src/cli.ts.
 * When Task 4 implements these functions, the imports will resolve and the
 * tests should pass (GREEN).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { DetailedUpdateInfo, VersionInfo } from "../src/types.js";

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
		spawn: vi.fn(() => {
			const ee = new EventEmitter() as EventEmitter & {
				on: ReturnType<typeof vi.fn>;
				stdout: { on: ReturnType<typeof vi.fn> };
				stderr: { on: ReturnType<typeof vi.fn> };
			};
			ee.on = vi.fn();
			ee.stdout = { on: vi.fn() };
			ee.stderr = { on: vi.fn() };
			process.nextTick(() => ee.emit("exit", 0));
			return ee;
		}),
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
import { spawn } from "node:child_process";
import { checkAllUpdates } from "../src/update-check.js";
// These imports will FAIL because the functions don't exist yet in src/cli.ts.
// This is the RED phase — the entire test file will fail at module load time.
import { runPreLaunch, selectVersionsPreLaunch } from "../src/cli.js";

const mockedLog = vi.mocked(clack.log);
const mockedSpawn = vi.mocked(spawn);
const mockedCheckAllUpdates = vi.mocked(checkAllUpdates);
const mockedSelect = vi.mocked(clack.select);
const mockedIsCancel = vi.mocked(clack.isCancel);

// ── Test Fixtures ────────────────────────────────────────────────
const matureVersion: VersionInfo = {
	version: "4.1.2",
	ageSeconds: 86400 * 5,
};

const immatureVersion: VersionInfo = {
	version: "4.2.0",
	ageSeconds: 86400 * 1,
};

const detailedUpdate: DetailedUpdateInfo = {
	type: "plugin",
	name: "oh-my-openagent",
	current: "4.0.0",
	versions: [immatureVersion, matureVersion],
};

const matureUpdateItem = {
	name: "oh-my-openagent",
	current: "4.0.0",
	selectedVersion: matureVersion,
};

const matureUpdateItem2 = {
	name: "some-other-pkg",
	current: "1.0.0",
	selectedVersion: { version: "1.1.0", ageSeconds: 86400 * 4 },
};

// ── Tests ────────────────────────────────────────────────────────
describe("runPreLaunch", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockedIsCancel.mockReturnValue(false);
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		exitSpy.mockRestore();
	});

	it("should skip update check and spawn opencode immediately when args are passed", async () => {
		await runPreLaunch(["-v"]);

		// No update check should run — just launch opencode directly
		expect(mockedCheckAllUpdates).not.toHaveBeenCalled();
		expect(mockedSpawn).toHaveBeenCalledWith("opencode", ["-v"], {
			stdio: "inherit",
		});
	});

	it("should spawn opencode without installing when user selects skip", async () => {
		mockedCheckAllUpdates.mockResolvedValue([detailedUpdate]);
		mockedSelect.mockResolvedValue("skip");

		await runPreLaunch([]);

		expect(mockedSpawn).toHaveBeenCalledWith("opencode", [], {
			stdio: "inherit",
		});
		expect(mockSpinnerInstance.start).not.toHaveBeenCalledWith(
			"Installing updates...",
		);
	});

	it("should install updates then spawn opencode when user selects install", async () => {
		mockedCheckAllUpdates.mockResolvedValue([detailedUpdate]);
		mockedSelect.mockResolvedValue("install");

		await runPreLaunch([]);

		expect(mockSpinnerInstance.start).toHaveBeenCalledWith(
			"Installing updates...",
		);
		expect(mockedSpawn).toHaveBeenCalledWith("opencode", [], {
			stdio: "inherit",
		});
	});

	it("should exit with code 1 when user cancels", async () => {
		mockedCheckAllUpdates.mockResolvedValue([detailedUpdate]);
		mockedIsCancel.mockReturnValue(true);
		mockedSelect.mockResolvedValue(Symbol("cancel"));

		await runPreLaunch([]);

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(mockedSpawn).not.toHaveBeenCalled();
	});

	it("should log warning and still spawn opencode on network error", async () => {
		mockedCheckAllUpdates.mockRejectedValue(
			new Error("Network failure"),
		);

		await runPreLaunch([]);

		expect(mockedLog.warn).toHaveBeenCalled();
		expect(mockedSpawn).toHaveBeenCalledWith("opencode", [], {
			stdio: "inherit",
		});
	});

	it("should skip update check and forward remaining CLI arguments to opencode spawn", async () => {
		await runPreLaunch(["--model", "gemini", "--debug"]);

		// No update check should run — just launch opencode directly
		expect(mockedCheckAllUpdates).not.toHaveBeenCalled();
		expect(mockedSpawn).toHaveBeenCalledWith("opencode", ["--model", "gemini", "--debug"], {
			stdio: "inherit",
		});
	});

	it("should exit with child process exit code when opencode exits non-zero", async () => {
		mockedCheckAllUpdates.mockResolvedValue([]);

		// Override spawn to emit exit code 5
		const customChild = new EventEmitter() as unknown as ChildProcess;
		mockedSpawn.mockReturnValue(customChild);

		await runPreLaunch([]);
		customChild.emit("exit", 5);

		expect(exitSpy).toHaveBeenCalledWith(5);
	});
});

describe("selectVersionsPreLaunch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedIsCancel.mockReturnValue(false);
	});

	it("should present skip, install, and cancel options", async () => {
		mockedSelect.mockResolvedValue("skip");

		const result = await selectVersionsPreLaunch([matureUpdateItem]);

		expect(mockedSelect).toHaveBeenCalledTimes(1);
		const callArgs = mockedSelect.mock.calls[0][0];
		expect(callArgs.options).toHaveLength(2);
		const values = callArgs.options.map(
			(o: { value: string }) => o.value,
		);
		expect(values).toContain("skip");
		expect(values).toContain("install");
	});

	it("should return 'skip' when user chooses to skip", async () => {
		mockedSelect.mockResolvedValue("skip");

		const result = await selectVersionsPreLaunch([matureUpdateItem]);

		expect(result).toBe("skip");
	});

	it("should return 'install' when user chooses to install", async () => {
		mockedSelect.mockResolvedValue("install");

		const result = await selectVersionsPreLaunch([matureUpdateItem, matureUpdateItem2]);

		expect(result).toBe("install");
	});
});

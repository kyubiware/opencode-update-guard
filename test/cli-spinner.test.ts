/**
 * TDD test for CLI spinner behavior during installation.
 *
 * RED: installPackage uses execSync which blocks the event loop,
 *      preventing the spinner from animating.
 * GREEN: installPackage uses async exec, yielding to the event loop
 *        so the spinner can render frames during installation.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock child_process — we expect async exec to be used, not sync execSync
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execSync: vi.fn(() => ""),
		exec: vi.fn((
			_cmd: string,
			_opts: unknown,
			_cb?: Function,
		) => {
			// exec can be called as (cmd, cb) or (cmd, opts, cb)
			const callback = typeof _opts === "function" ? _opts : _cb;
			// Simulate async exec completing successfully
			setTimeout(() => callback?.(null, { stdout: "", stderr: "" }), 1);
		}),
	};
});

// Mock @clack/prompts to capture spinner interactions
const mockSpinnerInstance = {
	start: vi.fn(),
	stop: vi.fn(),
	message: vi.fn(),
};

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => mockSpinnerInstance),
	log: { warn: vi.fn(), error: vi.fn() },
	note: vi.fn(),
	confirm: vi.fn(),
	multiselect: vi.fn(),
	isCancel: vi.fn(),
	cancel: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
	loadConfig: vi.fn(),
	getMaturitySecs: vi.fn(() => 86400 * 3),
	isMature: vi.fn((age: number) => age >= 86400 * 3),
	getConfigDir: vi.fn(() => "/mock/config/dir"),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	readFileSync: vi.fn(() => JSON.stringify({ plugin: [] })),
	writeFileSync: vi.fn(),
	realpathSync: vi.fn((p: string) => p),
}));

import { execSync, exec } from "node:child_process";
import * as clack from "@clack/prompts";
import { installPackage, installUpdates } from "../src/cli.js";

const mockedExecSync = vi.mocked(execSync);
const mockedExec = vi.mocked(exec);
const mockedSpinner = vi.mocked(clack.spinner);

describe("installPackage (TDD: async spinner support)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return a Promise (async) instead of a boolean (sync)", async () => {
		const result = installPackage("oh-my-openagent", "4.1.2", "plugin");

		// RED: This will fail because installPackage currently returns boolean synchronously
		// GREEN: After refactor, it returns Promise<boolean>
		expect(result).toBeInstanceOf(Promise);

		const success = await result;
		expect(success).toBe(true);
	});

	it("should use async exec instead of blocking execSync", async () => {
		await installPackage("oh-my-openagent", "4.1.2", "plugin");

		// Should call async exec, never the sync execSync
		expect(mockedExec).toHaveBeenCalledTimes(1);
		expect(mockedExecSync).not.toHaveBeenCalled();
	});
});

describe("installUpdates (TDD: spinner lifecycle)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should start spinner before installation and stop after", async () => {
		mockedSpinner.mockReturnValue(mockSpinnerInstance as any);

		const updates = [
			{
				type: "plugin" as const,
				name: "oh-my-openagent",
				current: "4.0.0",
				latest: "4.1.2",
				ageSeconds: 86400 * 4,
			},
		];

		// installUpdates must be async to allow spinner frames to render
		const result = installUpdates(updates);
		expect(result).toBeInstanceOf(Promise);

		await result;

		expect(mockedSpinner).toHaveBeenCalledTimes(1);
		expect(mockSpinnerInstance.start).toHaveBeenCalledWith("Installing updates...");
		expect(mockSpinnerInstance.message).toHaveBeenCalledWith(
			"Installing oh-my-openagent@4.1.2...",
		);
		expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("1 package(s) updated");
	});

	it("should report failures via spinner stop", async () => {
		// Make exec fail for this test
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, _cb?: Function) => {
			const callback = typeof _opts === "function" ? _opts : _cb;
			setTimeout(() => callback?.(new Error("npm install failed")), 1);
		});

		mockedSpinner.mockReturnValue(mockSpinnerInstance as any);

		const updates = [
			{
				type: "plugin" as const,
				name: "oh-my-openagent",
				current: "4.0.0",
				latest: "4.1.2",
				ageSeconds: 86400 * 4,
			},
		];

		await installUpdates(updates);

		expect(mockSpinnerInstance.stop).toHaveBeenCalledWith(
			"Installed 0, failed 1",
		);
	});
});

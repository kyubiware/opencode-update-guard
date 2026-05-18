/**
 * Tests for CLI install behavior — verifying that plugin versions
 * are updated in opencode.json after installation so they don't
 * reappear as available updates on subsequent runs.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock child_process so npm install is a no-op
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execSync: vi.fn(() => ""),
		exec: vi.fn((_cmd: string, _opts: unknown, cb: Function) => cb(null, { stdout: "" })),
	};
});

// Mock @clack/prompts (not needed for unit test logic)
vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
	log: { warn: vi.fn() },
}));

vi.mock("../src/config.js", () => ({
	loadConfig: vi.fn(),
	getMaturitySecs: vi.fn(() => 86400 * 3),
	getMaturityDays: vi.fn(() => 3),
	isMature: vi.fn((age: number) => age >= 86400 * 3),
	getConfigDir: vi.fn(() => "/mock/config/dir"),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

vi.mock("node:path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
}));

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { getConfigDir } from "../src/config.js";
import { updatePluginVersionInConfig } from "../src/cli.js";

const mockedExecSync = vi.mocked(execSync);
const mockedFs = vi.mocked(fs);
const mockedGetConfigDir = vi.mocked(getConfigDir);

describe("updatePluginVersionInConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedGetConfigDir.mockReturnValue("/mock/config/dir");
	});

	it("should update plugin version in opencode.json after install", () => {
		// Simulate opencode.json with an old plugin version
		const originalConfig = {
			plugin: [
				"opencode-update-guard@1.0.0",
				"oh-my-openagent@4.0.0",
				"@scope/pkg@2.0.0",
			],
		};
		mockedFs.existsSync.mockReturnValue(true);
		mockedFs.readFileSync.mockReturnValue(JSON.stringify(originalConfig));

		updatePluginVersionInConfig("oh-my-openagent", "4.1.2");

		// Should have written updated config
		expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
		const [writePath, writeContent] = mockedFs.writeFileSync.mock.calls[0];
		expect(writePath).toBe("/mock/config/dir/opencode.json");

		const written = JSON.parse(writeContent as string);
		expect(written.plugin).toContain("oh-my-openagent@4.1.2");
		expect(written.plugin).not.toContain("oh-my-openagent@4.0.0");
		// Other plugins untouched
		expect(written.plugin).toContain("opencode-update-guard@1.0.0");
		expect(written.plugin).toContain("@scope/pkg@2.0.0");
	});

	it("should handle scoped packages correctly", () => {
		const originalConfig = {
			plugin: [
				"opencode-update-guard@1.0.0",
				"@cortexkit/opencode-magic-context@0.18.0",
			],
		};
		mockedFs.existsSync.mockReturnValue(true);
		mockedFs.readFileSync.mockReturnValue(JSON.stringify(originalConfig));

		updatePluginVersionInConfig(
			"@cortexkit/opencode-magic-context",
			"0.20.0",
		);

		expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
		const written = JSON.parse(
			mockedFs.writeFileSync.mock.calls[0][1] as string,
		);
		expect(written.plugin).toContain(
			"@cortexkit/opencode-magic-context@0.20.0",
		);
		expect(written.plugin).not.toContain(
			"@cortexkit/opencode-magic-context@0.18.0",
		);
	});

	it("should be a no-op if the plugin is not registered", () => {
		const originalConfig = {
			plugin: ["other-plugin@1.0.0"],
		};
		mockedFs.existsSync.mockReturnValue(true);
		mockedFs.readFileSync.mockReturnValue(JSON.stringify(originalConfig));

		updatePluginVersionInConfig("unregistered-pkg", "9.0.0");

		expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
	});

	it("should handle opencode.jsonc fallback", () => {
		const originalConfig = {
			plugin: ["oh-my-openagent@4.0.0"],
		};
		// opencode.json doesn't exist, opencode.jsonc does
		mockedFs.existsSync
			.mockReturnValueOnce(false) // opencode.json
			.mockReturnValueOnce(true); // opencode.jsonc
		mockedFs.readFileSync.mockReturnValue(JSON.stringify(originalConfig));

		updatePluginVersionInConfig("oh-my-openagent", "4.1.2");

		const [writePath] = mockedFs.writeFileSync.mock.calls[0];
		expect(writePath).toBe("/mock/config/dir/opencode.jsonc");
	});
});

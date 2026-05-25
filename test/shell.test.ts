/**
 * TDD tests for shell detection and hook management.
 *
 * RED: Tests for detectShell, isHookInstalled, installHook, uninstallHook
 * GREEN: src/shell.ts implements the functions to make tests pass.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Module mocks ────────────────────────────────────────────────

vi.mock("node:child_process", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("node:child_process")>();
	return { ...actual, execSync: vi.fn() };
});

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({ homedir: vi.fn(() => "/home/testuser") }));

vi.mock("node:path", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("node:path")>();
	return {
		...actual,
		join: vi.fn((...args: string[]) => args.join("/")),
	};
});

// ── Imports (after mocks) ───────────────────────────────────────

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import {
	detectShell,
	isHookInstalled,
	installHook,
	uninstallHook,
} from "../src/shell.js";
import type { ShellInfo } from "../src/shell.js";

// ── Constants ───────────────────────────────────────────────────

const SHELL_MARKER = "# opencode-update-guard pre-launch wrapper";
const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedWriteFileSync = vi.mocked(fs.writeFileSync);
const mockedMkdirSync = vi.mocked(fs.mkdirSync);

// ── Helpers ─────────────────────────────────────────────────────

function makeShellInfo(
	type: ShellInfo["type"],
	configPath: string,
): ShellInfo {
	return { type, configPath };
}

// ── detectShell ─────────────────────────────────────────────────

describe("detectShell", () => {
	let originalShell: string | undefined;
	let originalPlatform: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		originalShell = process.env.SHELL;
		originalPlatform = process.platform;
		// Default: linux, so we test shell on unix-like
	});

	afterEach(() => {
		process.env.SHELL = originalShell;
		if (originalPlatform) {
			Object.defineProperty(process, "platform", {
				value: originalPlatform,
				configurable: true,
			});
		}
	});

	it("returns zsh info when $SHELL=/usr/bin/zsh", () => {
		process.env.SHELL = "/usr/bin/zsh";
		const result = detectShell();
		expect(result).toEqual(
			makeShellInfo("zsh", "/home/testuser/.zshrc"),
		);
	});

	it("returns bash info when $SHELL=/bin/bash", () => {
		process.env.SHELL = "/bin/bash";
		const result = detectShell();
		expect(result).toEqual(
			makeShellInfo("bash", "/home/testuser/.bashrc"),
		);
	});

	it("returns fish info when $SHELL=/usr/bin/fish", () => {
		process.env.SHELL = "/usr/bin/fish";
		const result = detectShell();
		expect(result).toEqual(
			makeShellInfo("fish", "/home/testuser/.config/fish/config.fish"),
		);
	});

	it("returns null when $SHELL=/bin/sh (unsupported)", () => {
		process.env.SHELL = "/bin/sh";
		expect(detectShell()).toBeNull();
	});

	it("falls back to parent process when $SHELL is empty", () => {
		process.env.SHELL = "";
		mockedExecSync.mockReturnValue("zsh");
		const result = detectShell();
		expect(result).toEqual(
			makeShellInfo("zsh", "/home/testuser/.zshrc"),
		);
		expect(mockedExecSync).toHaveBeenCalledWith(
			"ps -o comm= -p $PPID",
			expect.objectContaining({ encoding: "utf-8" }),
		);
	});

	it("returns null when $SHELL is empty and parent process is unsupported", () => {
		process.env.SHELL = "";
		mockedExecSync.mockReturnValue("sh");
		expect(detectShell()).toBeNull();
	});

	it("returns null when $SHELL is empty and execSync throws", () => {
		process.env.SHELL = "";
		mockedExecSync.mockImplementation(() => {
			throw new Error("no parent");
		});
		expect(detectShell()).toBeNull();
	});

	it("returns null on win32 platform", () => {
		Object.defineProperty(process, "platform", {
			value: "win32",
			configurable: true,
		});
		process.env.SHELL = "/usr/bin/zsh";
		expect(detectShell()).toBeNull();
	});

	it("does not call execSync when $SHELL is set", () => {
		process.env.SHELL = "/bin/bash";
		detectShell();
		expect(mockedExecSync).not.toHaveBeenCalled();
	});
});

// ── isHookInstalled ─────────────────────────────────────────────

describe("isHookInstalled", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true when rc file contains the marker", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			`# some config\n${SHELL_MARKER}\nopencode() {\n    opencode-update --pre-launch "$@"\n}\n`,
		);
		expect(isHookInstalled("bash", "/home/testuser/.bashrc")).toBe(
			true,
		);
	});

	it("returns false when marker is absent", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue("# some config\nalias ll='ls -la'\n");
		expect(isHookInstalled("zsh", "/home/testuser/.zshrc")).toBe(
			false,
		);
	});

	it("returns false when file doesn't exist", () => {
		mockedExistsSync.mockReturnValue(false);
		expect(
			isHookInstalled("fish", "/home/testuser/.config/fish/config.fish"),
		).toBe(false);
	});
});

// ── installHook ─────────────────────────────────────────────────

describe("installHook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("appends bash hook to existing file without marker", () => {
		const configPath = "/home/testuser/.bashrc";
		const existingContent = "# some existing config\nalias ll='ls -la'\n";
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(existingContent);

		installHook("bash", configPath);

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const written = mockedWriteFileSync.mock.calls[0][1] as string;
		expect(written).toContain(SHELL_MARKER);
		expect(written).toContain("opencode() {");
		expect(written).toContain("opencode-update --pre-launch \"$@\"");
		expect(written).toContain("}");
		expect(written).toContain(existingContent.trimEnd());
	});

	it("appends fish hook to existing file without marker", () => {
		const configPath = "/home/testuser/.config/fish/config.fish";
		const existingContent = "# some fish config\n";
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(existingContent);

		installHook("fish", configPath);

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const written = mockedWriteFileSync.mock.calls[0][1] as string;
		expect(written).toContain(SHELL_MARKER);
		expect(written).toContain("function opencode");
		expect(written).toContain("opencode-update --pre-launch $argv");
		expect(written).toContain("end");
	});

	it("is idempotent: second call does nothing if marker exists", () => {
		const configPath = "/home/testuser/.bashrc";
		const contentWithHook = `# some config\n${SHELL_MARKER}\nopencode() {\n    opencode-update --pre-launch "$@"\n}\n`;
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(contentWithHook);

		installHook("bash", configPath);

		expect(mockedWriteFileSync).not.toHaveBeenCalled();
	});

	it("creates file + parent dirs if file is missing", () => {
		const configPath = "/home/testuser/.bashrc";
		mockedExistsSync.mockReturnValue(false);

		installHook("bash", configPath);

		expect(mockedMkdirSync).toHaveBeenCalledWith(
			"/home/testuser",
			{ recursive: true },
		);
		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const written = mockedWriteFileSync.mock.calls[0][1] as string;
		expect(written).toContain(SHELL_MARKER);
		expect(written).toContain("opencode() {");
	});
});

// ── uninstallHook ───────────────────────────────────────────────

describe("uninstallHook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("removes bash function block (marker through closing })", () => {
		const configPath = "/home/testuser/.bashrc";
		const content = `# existing config
alias ll='ls -la'

${SHELL_MARKER}
opencode() {
    opencode-update --pre-launch "$@"
}

# more config
`;
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(content);

		uninstallHook("bash", configPath);

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const written = mockedWriteFileSync.mock.calls[0][1] as string;
		expect(written).not.toContain(SHELL_MARKER);
		expect(written).not.toContain("opencode() {");
		expect(written).toContain("# existing config");
		expect(written).toContain("# more config");
	});

	it("removes fish function block (marker through end)", () => {
		const configPath = "/home/testuser/.config/fish/config.fish";
		const content = `# existing fish config

${SHELL_MARKER}
function opencode
    opencode-update --pre-launch $argv
end

# more fish config
`;
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(content);

		uninstallHook("fish", configPath);

		expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
		const written = mockedWriteFileSync.mock.calls[0][1] as string;
		expect(written).not.toContain(SHELL_MARKER);
		expect(written).not.toContain("function opencode");
		expect(written).toContain("# existing fish config");
		expect(written).toContain("# more fish config");
	});

	it("leaves rest of file intact after removal", () => {
		const configPath = "/home/testuser/.bashrc";
		const content = `# line 1
# line 2

${SHELL_MARKER}
opencode() {
    opencode-update --pre-launch "$@"
}

# line 3
`;
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(content);

		uninstallHook("bash", configPath);

		const written = mockedWriteFileSync.mock.calls[0][1] as string;
		expect(written).toContain("# line 1");
		expect(written).toContain("# line 2");
		expect(written).toContain("# line 3");
	});

	it("does nothing if hook is not present (no marker)", () => {
		const configPath = "/home/testuser/.bashrc";
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			"# some config\nalias ll='ls -la'\n",
		);

		uninstallHook("bash", configPath);

		expect(mockedWriteFileSync).not.toHaveBeenCalled();
	});

	it("handles file-not-found gracefully (no crash)", () => {
		const configPath = "/home/testuser/.bashrc";
		mockedExistsSync.mockReturnValue(false);

		expect(() => uninstallHook("bash", configPath)).not.toThrow();
		expect(mockedWriteFileSync).not.toHaveBeenCalled();
	});

	it("is idempotent: second call does nothing after first removal", () => {
		const configPath = "/home/testuser/.bashrc";
		// File no longer has the hook after first uninstall
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			"# some config\nalias ll='ls -la'\n",
		);

		uninstallHook("bash", configPath);

		expect(mockedWriteFileSync).not.toHaveBeenCalled();
	});
});

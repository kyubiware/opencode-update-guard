/**
 * Tests for bin/install.cjs — register() and unregister()
 *
 * Runs the install script as a child process with a mocked CONFIG_DIR
 * and verifies autoupdate is set/cleared correctly in opencode.json.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

let tmpDir: string;

function readConfig(dir: string): Record<string, unknown> | null {
	for (const name of ["opencode.json", "opencode.jsonc"]) {
		const p = path.join(dir, name);
		if (fs.existsSync(p)) {
			return JSON.parse(fs.readFileSync(p, "utf-8"));
		}
	}
	return null;
}

function writeConfig(
	dir: string,
	config: Record<string, unknown>,
): void {
	fs.writeFileSync(
		path.join(dir, "opencode.json"),
		`${JSON.stringify(config, null, 2)}\n`,
	);
}

function runInstall(dir: string, args: string = ""): void {
	const projectRoot = path.join(__dirname, "..");
	const src = fs.readFileSync(
		path.join(projectRoot, "bin", "install.cjs"),
		"utf-8",
	);
	// Replace CONFIG_DIR
	let patched = src.replace(
		/const CONFIG_DIR\s*=.*$/m,
		`const CONFIG_DIR = ${JSON.stringify(dir)}`,
	);
	// Replace the package.json read path (line 17 of install.cjs)
	// Original: fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
	const pkgPath = JSON.stringify(path.join(projectRoot, "package.json"));
	patched = patched.replace(
		/path\.join\(__dirname,\s*"\.\.",\s*"package\.json"\)/,
		pkgPath,
	);
	const tmpScript = path.join(dir, "_run_test.cjs");
	fs.writeFileSync(tmpScript, patched);
	execSync(`node ${tmpScript} ${args}`, { stdio: "pipe" });
}

describe("install.cjs register()", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should set autoupdate to false when registering plugin for the first time", () => {
		writeConfig(tmpDir, {});
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config).toBeDefined();
		expect(config!.autoupdate).toBe(false);
		expect(config!.plugin).toBeDefined();
		expect((config!.plugin as string[]).length).toBeGreaterThan(0);
	});

	it("should set autoupdate to false when updating an existing plugin registration", () => {
		writeConfig(tmpDir, {
			plugin: ["opencode-update-guard@0.1.0"],
			autoupdate: true,
		});
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config!.autoupdate).toBe(false);
	});

	it("should keep autoupdate:false if already false", () => {
		writeConfig(tmpDir, {
			plugin: [],
			autoupdate: false,
		});
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config!.autoupdate).toBe(false);
	});
});

describe("install.cjs unregister()", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should restore autoupdate to true when unregistering plugin", () => {
		writeConfig(tmpDir, {
			plugin: ["opencode-update-guard@0.1.2"],
			autoupdate: false,
		});
		runInstall(tmpDir, "uninstall");

		const config = readConfig(tmpDir);
		expect(config!.autoupdate).toBe(true);
		expect(config!.plugin).toEqual([]);
	});
});

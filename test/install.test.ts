/**
 * Tests for bin/install.cjs — disabled autoupdate
 *
 * Runs the install script as a child process with a mocked CONFIG_DIR
 * and verifies autoupdate is set correctly in opencode.json.
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

function runInstall(dir: string): void {
	const projectRoot = path.join(__dirname, "..");
	const src = fs.readFileSync(
		path.join(projectRoot, "bin", "install.cjs"),
		"utf-8",
	);
	// Replace CONFIG_DIR to point to our temp dir
	const patched = src.replace(
		/const CONFIG_DIR\s*=.*$/m,
		`const CONFIG_DIR = ${JSON.stringify(dir)}`,
	);
	const tmpScript = path.join(dir, "_run_test.cjs");
	fs.writeFileSync(tmpScript, patched);
	execSync(`node ${tmpScript}`, { stdio: "pipe" });
}

describe("install.cjs", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should set autoupdate to false in existing config", () => {
		writeConfig(tmpDir, { someField: "keep-me" });
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config).toBeDefined();
		expect(config!.autoupdate).toBe(false);
		expect(config!.someField).toBe("keep-me");
	});

	it("should set autoupdate to false when config has autoupdate: true", () => {
		writeConfig(tmpDir, { autoupdate: true });
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config!.autoupdate).toBe(false);
	});

	it("should keep autoupdate:false if already false", () => {
		writeConfig(tmpDir, { autoupdate: false });
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config!.autoupdate).toBe(false);
	});

	it("should create config file when none exists", () => {
		runInstall(tmpDir);

		const config = readConfig(tmpDir);
		expect(config).toBeDefined();
		expect(config!.autoupdate).toBe(false);
	});
});

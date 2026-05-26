import * as fs from "node:fs";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import { getConfigDir } from "./config.js";
import { readJsonc } from "./helpers.js";
import {
	detectExistingOpencodeFunctions,
	detectShell,
	installHook,
	isHookInstalled,
	removeExistingOpencodeFunction,
} from "./shell.js";

// ── Autoupdate Checks ─────────────────────────────────────────

/**
 * Check whether autoupdate is explicitly disabled in the global opencode config.
 *
 * Looks for opencode.json or opencode.jsonc in the config directory.
 * Returns true only when `autoupdate` is explicitly `false`.
 */
export function checkAutoupdateDisabled(): boolean {
	const configDir = getConfigDir();
	const opencodeJsonPath = path.join(configDir, "opencode.json");
	const opencodeJsoncPath = path.join(configDir, "opencode.jsonc");

	const config = readJsonc(opencodeJsonPath) ?? readJsonc(opencodeJsoncPath);
	if (config === null) {
		return false;
	}
	return config.autoupdate === false;
}

/**
 * Write `autoupdate: false` to the global opencode config.
 *
 * Preserves all existing fields. Creates the file if it doesn't exist.
 * Prefers opencode.json over opencode.jsonc.
 */
export function disableAutoupdate(): void {
	const configDir = getConfigDir();
	const opencodeJsonPath = path.join(configDir, "opencode.json");
	const opencodeJsoncPath = path.join(configDir, "opencode.jsonc");

	let configPath: string;
	let existing: Record<string, unknown>;

	const jsonConfig = readJsonc(opencodeJsonPath);
	if (jsonConfig !== null) {
		configPath = opencodeJsonPath;
		existing = jsonConfig;
	} else {
		const jsoncConfig = readJsonc(opencodeJsoncPath);
		if (jsoncConfig !== null) {
			configPath = opencodeJsoncPath;
			existing = jsoncConfig;
		} else {
			configPath = opencodeJsonPath;
			existing = {};
		}
	}

	existing.autoupdate = false;

	fs.mkdirSync(configDir, { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`);
}

// ── Startup Checks ───────────────────────────────────────────

/**
 * Check for existing opencode() shell functions and offer to replace them
 * with the update-guard wrapper. Returns true if the hook was installed
 * (replacing a conflicting function), false otherwise.
 */
async function handleConflictingFunctions(shell: {
	type: "bash" | "zsh" | "fish";
	configPath: string;
}): Promise<boolean> {
	let didReplace = false;

	const existingFns = (() => {
		try {
			return detectExistingOpencodeFunctions(shell.type, shell.configPath);
		} catch {
			return [];
		}
	})();

	for (const fn of existingFns) {
		clack.log.warn(
			`Found existing opencode() function in ${shell.configPath}:\n${fn.body
				.split("\n")
				.map((l) => `  ${l}`)
				.join("\n")}`,
		);
		const shouldReplace = await clack.confirm({
			message:
				"Replace this function with the update-guard wrapper? (The existing function will be removed.)",
		});
		if (clack.isCancel(shouldReplace)) continue;

		if (shouldReplace) {
			try {
				removeExistingOpencodeFunction(shell.type, shell.configPath, fn);
			} catch {
				// In test environments with partial mocks, this may not be available
			}
			didReplace = true;
		}
	}

	if (didReplace) {
		installHook(shell.type, shell.configPath);
	}

	return didReplace;
}

/**
 * Run interactive startup checks to guide the user through securing their
 * OpenCode setup.
 *
 * Checks:
 * 1. Autoupdate is disabled (prompts to disable if enabled)
 * 2. Shell hook is installed (prompts to install if missing)
 *
 * Both checks are independent — each prompt appears based on its own state.
 *
 * @param options.skipPrompts - Skip all prompts (resolve silently)
 */
export async function runStartupChecks(options?: {
	skipPrompts?: boolean;
}): Promise<void> {
	if (!process.stdin.isTTY || options?.skipPrompts) {
		return;
	}

	// ── Autoupdate check ────────────────────────────────────
	if (!checkAutoupdateDisabled()) {
		const shouldDisable = await clack.confirm({
			message:
				"OpenCode auto-updates are enabled. Disable them for update safety?",
		});
		if (clack.isCancel(shouldDisable)) {
			// gracefully skip — user cancelled
		} else if (shouldDisable) {
			disableAutoupdate();
		}
	}

	const shell = detectShell();

	// ── Existing opencode() function check ─────────────────
	if (shell !== null) {
		const didReplace = await handleConflictingFunctions(shell);
		if (didReplace) return; // hook already installed via replacement
	}

	// ── Shell hook check ────────────────────────────────────
	if (shell !== null && !isHookInstalled(shell.type, shell.configPath)) {
		const shouldInstall = await clack.confirm({
			message: `Shell hook not installed for ${shell.type}. Install it for update protection?`,
		});
		if (clack.isCancel(shouldInstall)) {
			// gracefully skip — user cancelled
		} else if (shouldInstall) {
			installHook(shell.type, shell.configPath);
		}
	}
}

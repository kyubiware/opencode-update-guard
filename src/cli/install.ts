import { exec, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import { getConfigDir } from "../config.js";

// ── Config Update ──────────────────────────────────────────────

/**
 * Update the version reference for a plugin in the global opencode config.
 * This ensures checkForUpdates won't re-report the same update on the next run.
 */
export function updatePluginVersionInConfig(
	name: string,
	version: string,
): void {
	const configDir = getConfigDir();
	let configPath = path.join(configDir, "opencode.json");
	if (!fs.existsSync(configPath)) {
		configPath = path.join(configDir, "opencode.jsonc");
	}
	if (!fs.existsSync(configPath)) return;

	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		const config = JSON.parse(raw) as Record<string, unknown>;
		const plugins = config.plugin as string[] | undefined;
		if (!plugins) return;

		const prefix = `${name}@`;
		const idx = plugins.findIndex(
			(p) => typeof p === "string" && p.startsWith(prefix),
		);
		if (idx === -1) return;

		plugins[idx] = `${name}@${version}`;
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	} catch {
		// non-critical — next run will re-detect, but won't break install
	}
}

// ── Execution ──────────────────────────────────────────────────

function execAsync(cmd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		exec(cmd, (err: Error | null) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

// ── Install ────────────────────────────────────────────────────

export async function installPackage(
	name: string,
	version: string,
	type: string,
): Promise<boolean> {
	try {
		if (type === "cli") {
			await execAsync(`npm install -g opencode-ai@${version}`);
		} else if (type === "plugin") {
			await execAsync(`npm install -g ${name}@${version}`);
			updatePluginVersionInConfig(name, version);
		}
		return true;
	} catch {
		return false;
	}
}

/** A single item to install — name, version, and type. */
export interface InstallItem {
	name: string;
	version: string;
	type: "cli" | "plugin";
}

export async function installUpdates(toInstall: InstallItem[]): Promise<void> {
	const installSpinner = clack.spinner();
	installSpinner.start("Installing updates...");
	let installed = 0;
	let failed = 0;

	for (const u of toInstall) {
		installSpinner.message(`Installing ${u.name}@${u.version}...`);
		const success = await installPackage(u.name, u.version, u.type);
		if (success) {
			installed++;
		} else {
			failed++;
		}
	}

	if (failed > 0) {
		installSpinner.stop(`Installed ${installed}, failed ${failed}`);
		clack.log.warn(
			`${failed} update(s) failed. Check npm permissions and try again.`,
		);
	} else {
		installSpinner.stop(`${installed} package(s) updated`);
	}

	clack.outro("Done! Restart opencode to use updated packages.");
}

export function launchOpencode(cliArgs: string[]): void {
	const child = spawn("opencode", cliArgs, { stdio: "inherit" });
	child.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}

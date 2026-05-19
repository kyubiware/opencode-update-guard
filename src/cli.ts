#!/usr/bin/env node

import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import {
	getConfigDir,
	getMaturitySecs,
	isMature,
	loadConfig,
} from "./config.js";
import { formatAge } from "./helpers.js";
import type { UpdateInfo } from "./types.js";
import { checkForUpdates } from "./update-check.js";

// ── Partition ──────────────────────────────────────────────────

export function partitionUpdates(updates: UpdateInfo[]): {
	mature: UpdateInfo[];
	immature: UpdateInfo[];
} {
	const mature: UpdateInfo[] = [];
	const immature: UpdateInfo[] = [];
	for (const u of updates) {
		if (isMature(u.ageSeconds)) {
			mature.push(u);
		} else {
			immature.push(u);
		}
	}
	return { mature, immature };
}

// ── Immature Confirmation ──────────────────────────────────────

export async function confirmImmatureUpdates(
	immature: UpdateInfo[],
): Promise<boolean | "cancel"> {
	if (immature.length === 0) return true;

	const names = immature.map((u) => u.name).join(", ");
	const confirmed = await clack.confirm({
		message: `⚠️ ${immature.length} IMMATURE update(s) (${names}). Install anyway?`,
	});

	if (clack.isCancel(confirmed)) return "cancel";
	return confirmed;
}

// ── Selection Menu ─────────────────────────────────────────────

export async function selectUpdates(
	updates: UpdateInfo[],
): Promise<UpdateInfo[] | "cancel"> {
	const { mature, immature } = partitionUpdates(updates);

	type Choice = "mature" | "all" | "select";
	const options: { value: Choice; label: string; hint?: string }[] = [];

	if (mature.length > 0) {
		options.push({
			value: "mature",
			label: `Install ${mature.length} mature update(s) only`,
			hint: "safe",
		});
	}

	options.push({
		value: "all",
		label: `Install all ${updates.length} update(s)`,
		hint: immature.length > 0 ? "includes immature" : undefined,
	});

	options.push({
		value: "select",
		label: "Select updates individually",
	});

	const choice = await clack.select<Choice>({
		message: "What would you like to do?",
		options,
	});

	if (clack.isCancel(choice)) return "cancel";

	if (choice === "mature") return mature;
	if (choice === "all") return updates;

	// Individual selection
	const selected = await clack.multiselect({
		message: "Select updates to install",
		options: updates.map((u) => ({
			value: u,
			label: `${u.name} ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old) ${isMature(u.ageSeconds) ? "✓ ready" : "⏳ waiting"}`,
			hint: u.type,
		})),
		required: false,
	});

	if (clack.isCancel(selected)) return "cancel";

	return selected as UpdateInfo[];
}

const args = process.argv.slice(2);
const flagAll = args.includes("--all") || args.includes("-a");

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
		// Parse preserving order — we need to find and replace the plugin ref
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

function execAsync(cmd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		exec(cmd, (err: Error | null) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

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

export async function installUpdates(toInstall: UpdateInfo[]): Promise<void> {
	const installSpinner = clack.spinner();
	installSpinner.start("Installing updates...");
	let installed = 0;
	let failed = 0;

	for (const u of toInstall) {
		installSpinner.message(`Installing ${u.name}@${u.latest}...`);
		const success = await installPackage(u.name, u.latest, u.type);
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

async function main() {
	clack.intro("Update Guard");

	const s = clack.spinner();
	s.start("Checking for updates...");

	loadConfig();
	const updates = await checkForUpdates();

	s.stop(`Found ${updates.length} update(s)`);

	if (updates.length === 0) {
		clack.outro("All packages are up to date ✓");
		return;
	}

	const { mature, immature } = partitionUpdates(updates);

	// Build summary showing both mature and immature updates
	const lines: string[] = [];
	if (mature.length > 0) {
		lines.push(`  ${mature.length} update(s) ready to install:`);
		for (const u of mature) {
			lines.push(
				`    • ${u.name} ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`,
			);
		}
	}
	if (immature.length > 0) {
		lines.push("");
		lines.push(`  ${immature.length} update(s) waiting for maturity:`);
		const maturitySecs = getMaturitySecs();
		for (const u of immature) {
			const remaining = maturitySecs - u.ageSeconds;
			lines.push(
				`    • ${u.name} ${u.current} → ${u.latest} (${formatAge(remaining)} remaining)`,
			);
		}
	}

	clack.note(lines.join("\n"), "Available Updates");

	// --all flag: install all updates (including immature) without prompting
	if (flagAll) {
		const confirmed = await confirmImmatureUpdates(immature);
		if (confirmed === "cancel") {
			clack.cancel("Cancelled");
			return;
		}
		if (confirmed === false) {
			clack.outro("Install cancelled.");
			return;
		}
		await installUpdates(updates);
		return;
	}

	// Interactive selection
	const selected = await selectUpdates(updates);

	if (selected === "cancel") {
		clack.cancel("Cancelled");
		return;
	}

	if (selected.length === 0) {
		clack.outro("No updates selected.");
		return;
	}

	// Check if any immature updates were selected
	const { immature: selectedImmature } = partitionUpdates(selected);
	if (selectedImmature.length > 0) {
		const confirmed = await confirmImmatureUpdates(selectedImmature);
		if (confirmed === "cancel") {
			clack.cancel("Cancelled");
			return;
		}
		if (confirmed === false) {
			clack.outro("Install cancelled.");
			return;
		}
	}

	await installUpdates(selected);
}

// Only run main when this file is executed directly, not when imported for tests
if (import.meta.url.startsWith("file:")) {
	const modulePath = new URL(import.meta.url).pathname;
	const argvResolved = fs.realpathSync(process.argv[1]);
	if (argvResolved === modulePath) {
		main().catch((err) => {
			clack.log.error(`Unexpected error: ${err}`);
			process.exit(1);
		});
	}
}

#!/usr/bin/env node

import * as fs from "node:fs";
import * as clack from "@clack/prompts";
import { getMaturitySecs, isMature, loadConfig } from "./config.js";
import { formatAge } from "./helpers.js";
import { runStartupChecks } from "./setup.js";
import { detectShell, isHookInstalled, uninstallHook } from "./shell.js";
import type { DetailedUpdateInfo, UpdateInfo } from "./types.js";
import { checkAllUpdates } from "./update-check.js";

export type { InstallItem } from "./cli/install.js";
export {
	installPackage,
	installUpdates,
	launchOpencode,
	updatePluginVersionInConfig,
} from "./cli/install.js";
// Re-export everything from submodules so tests don't need to change
export {
	confirmImmatureUpdates,
	partitionUpdates,
	partitionVersions,
	selectUpdates,
	selectVersions,
	selectVersionsPreLaunch,
} from "./cli/select.js";

import type { InstallItem } from "./cli/install.js";
import { installUpdates, launchOpencode } from "./cli/install.js";
import {
	confirmImmatureUpdates,
	partitionVersions,
	selectVersions,
	selectVersionsPreLaunch,
} from "./cli/select.js";

// ── Flags ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flagPreLaunch = args.includes("--pre-launch");
const flagUninstallHook = args.includes("--uninstall-hook");
const flagAll = args.includes("--all") || args.includes("-a");
const hasFlags = flagPreLaunch || flagUninstallHook || flagAll;

// ── Summary ────────────────────────────────────────────────────

/** Build a human-readable summary of available updates grouped by status. */
function buildUpdateSummary(detailedUpdates: DetailedUpdateInfo[]): string {
	const lines: string[] = [];
	const readyLines: string[] = [];
	const waitingLines: string[] = [];
	let readyCount = 0;
	let waitingPkgCount = 0;

	for (const pkg of detailedUpdates) {
		const { newestMature, immature } = partitionVersions(pkg.versions);
		if (newestMature) {
			readyCount++;
			readyLines.push(
				`    • ${pkg.name} ${pkg.current} → ${newestMature.version} (${formatAge(newestMature.ageSeconds)} old)`,
			);
		}
		if (immature.length > 0) {
			waitingPkgCount++;
			waitingLines.push(`    • ${pkg.name} ${pkg.current}:`);
			const maturitySecs = getMaturitySecs();
			for (const v of immature) {
				const remaining = maturitySecs - v.ageSeconds;
				waitingLines.push(
					`       · ${v.version} (${formatAge(remaining)} remaining)`,
				);
			}
		}
	}

	if (readyCount > 0) {
		lines.push(`  ${readyCount} update(s) ready to install:`);
		lines.push(...readyLines);
	}
	if (waitingPkgCount > 0) {
		if (readyCount > 0) lines.push("");
		lines.push(`  ${waitingPkgCount} update(s) waiting for maturity:`);
		lines.push(...waitingLines);
	}

	return lines.join("\n");
}

// ── Install Flows ──────────────────────────────────────────────

/** Handle the --all flag: build install list, confirm immature, install. */
async function installAllWithConfirmation(
	detailedUpdates: DetailedUpdateInfo[],
): Promise<void> {
	const toInstall: InstallItem[] = [];
	const immature: UpdateInfo[] = [];
	for (const pkg of detailedUpdates) {
		const { newestMature } = partitionVersions(pkg.versions);
		const selectedVersion = newestMature ?? pkg.versions[0];
		toInstall.push({
			name: pkg.name,
			version: selectedVersion.version,
			type: pkg.type,
		});
		if (!isMature(selectedVersion.ageSeconds)) {
			immature.push({
				type: pkg.type,
				name: pkg.name,
				current: pkg.current,
				latest: selectedVersion.version,
				ageSeconds: selectedVersion.ageSeconds,
			});
		}
	}
	const confirmed = await confirmImmatureUpdates(immature);
	if (confirmed === "cancel") {
		clack.cancel("Cancelled");
		return;
	}
	if (confirmed === false) {
		clack.outro("Install cancelled.");
		return;
	}
	await installUpdates(toInstall);
}

/** Handle interactive selection flow: let user pick versions, confirm immature, install. */
async function installInteractive(
	detailedUpdates: DetailedUpdateInfo[],
): Promise<void> {
	const selected = await selectVersions(detailedUpdates);

	if (selected === "cancel") {
		clack.cancel("Cancelled");
		return;
	}

	if (selected.length === 0) {
		clack.outro("No updates selected.");
		return;
	}

	const toInstall: InstallItem[] = selected.map((r) => ({
		name: r.name,
		version: r.selectedVersion.version,
		type: r.type,
	}));

	const selectedImmature: UpdateInfo[] = selected
		.filter((r) => !isMature(r.selectedVersion.ageSeconds))
		.map((r) => ({
			type: r.type,
			name: r.name,
			current: r.current,
			latest: r.selectedVersion.version,
			ageSeconds: r.selectedVersion.ageSeconds,
		}));

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

	await installUpdates(toInstall);
}

// ── Main CLI Entry ─────────────────────────────────────────────

export async function main(options?: {
	skipStartupChecks?: boolean;
}): Promise<void> {
	if (!hasFlags && !options?.skipStartupChecks && process.stdin.isTTY) {
		await runStartupChecks();
	}

	clack.intro("Update Guard");

	const s = clack.spinner();
	s.start("Checking for updates...");

	loadConfig();
	const detailedUpdates = await checkAllUpdates();

	s.stop(`Found ${detailedUpdates.length} update(s)`);

	if (detailedUpdates.length === 0) {
		clack.outro("All packages are up to date ✓");
		return;
	}

	clack.note(buildUpdateSummary(detailedUpdates), "Available Updates");

	if (flagAll) {
		await installAllWithConfirmation(detailedUpdates);
		return;
	}

	await installInteractive(detailedUpdates);
}

// ── Pre-Launch ─────────────────────────────────────────────────

export async function runPreLaunch(opencodeArgs: string[]): Promise<void> {
	// Skip update check when CLI subcommands are being run (e.g. "opencode auth logout").
	// Only run the full check for interactive TUI sessions (no args).
	if (opencodeArgs.length > 0) {
		launchOpencode(opencodeArgs);
		return;
	}

	try {
		loadConfig();
		const detailedUpdates = await checkAllUpdates();
		const mature = detailedUpdates.filter(
			(u) => partitionVersions(u.versions).newestMature !== null,
		);
		if (mature.length === 0) {
			if (detailedUpdates.length > 0) {
				// Show brief note for immature-only updates
				const lines: string[] = [];
				for (const pkg of detailedUpdates) {
					const { immature } = partitionVersions(pkg.versions);
					if (immature.length === 0) continue;
					const nearest = immature[0];
					const remaining = formatAge(getMaturitySecs() - nearest.ageSeconds);
					lines.push(
						`    • ${pkg.name} ${pkg.current} → ${nearest.version} (${remaining} remaining)`,
					);
				}
				clack.log.info(
					`${detailedUpdates.length} update(s) pending maturity:\n${lines.join("\n")}`,
				);
			}
			launchOpencode(opencodeArgs);
			return;
		}
		const choice = await selectVersionsPreLaunch(mature.length);
		if (choice === "cancel") {
			process.exit(1);
			return;
		}
		if (choice === "install") {
			const toInstall: InstallItem[] = mature.map((pkg) => {
				const { newestMature } = partitionVersions(pkg.versions);
				if (!newestMature) {
					throw new Error("Unexpected null newestMature");
				}
				return {
					name: pkg.name,
					version: newestMature.version,
					type: pkg.type,
				};
			});
			await installUpdates(toInstall);
		}
		launchOpencode(opencodeArgs);
	} catch (err) {
		clack.log.warn(`Update check failed: ${err}. Launching opencode anyway.`);
		launchOpencode(opencodeArgs);
	}
}

// ── Uninstall Hook ─────────────────────────────────────────────

export async function handleUninstallHook(): Promise<void> {
	const shell = detectShell();
	if (!shell) {
		clack.log.warn("Unsupported shell detected. Cannot uninstall hook.");
		return;
	}
	if (!isHookInstalled(shell.type, shell.configPath)) {
		clack.log.info("Shell wrapper not installed. Nothing to remove.");
		return;
	}
	uninstallHook(shell.type, shell.configPath);
	clack.log.success(`Removed opencode wrapper from ${shell.configPath}`);
}

// ── Entry Point ────────────────────────────────────────────────

// Only run main when this file is executed directly, not when imported for tests
if (import.meta.url.startsWith("file:")) {
	const modulePath = new URL(import.meta.url).pathname;
	const argvResolved = fs.realpathSync(process.argv[1]);
	if (argvResolved === modulePath) {
		if (flagUninstallHook) {
			handleUninstallHook().catch((err) => {
				clack.log.error(`Unexpected error: ${err}`);
				process.exit(1);
			});
		} else if (flagPreLaunch) {
			const opencodeArgs = args.filter((a) => a !== "--pre-launch");
			runPreLaunch(opencodeArgs).catch((err) => {
				clack.log.error(`Unexpected error: ${err}`);
				process.exit(1);
			});
		} else {
			main().catch((err) => {
				clack.log.error(`Unexpected error: ${err}`);
				process.exit(1);
			});
		}
	}
}

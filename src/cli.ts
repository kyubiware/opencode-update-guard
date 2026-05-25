#!/usr/bin/env node

import { exec, spawn } from "node:child_process";
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
import { runStartupChecks } from "./setup.js";
import { detectShell, isHookInstalled, uninstallHook } from "./shell.js";
import type { DetailedUpdateInfo, UpdateInfo, VersionInfo } from "./types.js";
import { checkAllUpdates } from "./update-check.js";

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

export function partitionVersions(versions: VersionInfo[]): {
	newestMature: VersionInfo | null;
	immature: VersionInfo[];
} {
	const mature: VersionInfo[] = [];
	const immature: VersionInfo[] = [];

	for (const v of versions) {
		if (isMature(v.ageSeconds)) {
			mature.push(v);
		} else {
			immature.push(v);
		}
	}

	// Sort immature descending by semver
	immature.sort((a, b) => compareSemver(b.version, a.version));

	// Find newest mature (highest semver)
	let newestMature: VersionInfo | null = null;
	for (const v of mature) {
		if (
			newestMature === null ||
			compareSemver(v.version, newestMature.version) > 0
		) {
			newestMature = v;
		}
	}

	return { newestMature, immature };
}

/** Compare two semver strings numerically (e.g. "2.1.0" > "1.9.9"). */
function compareSemver(a: string, b: string): number {
	const partsA = a.split(".").map((s) => {
		const n = Number(s);
		return Number.isNaN(n) ? 0 : n;
	});
	const partsB = b.split(".").map((s) => {
		const n = Number(s);
		return Number.isNaN(n) ? 0 : n;
	});
	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const na = partsA[i] ?? 0;
		const nb = partsB[i] ?? 0;
		if (na > nb) return 1;
		if (na < nb) return -1;
	}
	return 0;
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

export async function selectVersions(updates: DetailedUpdateInfo[]): Promise<
	| {
			name: string;
			type: "cli" | "plugin";
			current: string;
			selectedVersion: VersionInfo;
	  }[]
	| "cancel"
> {
	const hasMature = updates.some(
		(u) => partitionVersions(u.versions).newestMature !== null,
	);

	type Choice = "mature" | "all" | "select";
	const options: { value: Choice; label: string; hint?: string }[] = [];

	if (hasMature) {
		options.push({
			value: "mature",
			label: "Install mature version(s) only",
			hint: "safe",
		});
	}

	options.push({
		value: "all",
		label: `Install all ${updates.length} latest version(s)`,
		hint: hasMature ? undefined : "includes immature",
	});

	options.push({
		value: "select",
		label: "Select versions individually",
	});

	const choice = await clack.select<Choice>({
		message: "What would you like to do?",
		options,
	});

	if (clack.isCancel(choice)) return "cancel";

	if (choice === "mature") {
		const result: {
			name: string;
			type: "cli" | "plugin";
			current: string;
			selectedVersion: VersionInfo;
		}[] = [];
		for (const u of updates) {
			const { newestMature } = partitionVersions(u.versions);
			if (newestMature) {
				result.push({
					name: u.name,
					type: u.type,
					current: u.current,
					selectedVersion: newestMature,
				});
			}
		}
		return result;
	}

	if (choice === "all") {
		const result: {
			name: string;
			type: "cli" | "plugin";
			current: string;
			selectedVersion: VersionInfo;
		}[] = [];
		for (const u of updates) {
			const { newestMature } = partitionVersions(u.versions);
			result.push({
				name: u.name,
				type: u.type,
				current: u.current,
				selectedVersion: newestMature ?? u.versions[0],
			});
		}
		return result;
	}

	// Individual selection — two-step flow
	const selectedPackages = await clack.multiselect({
		message: "Select packages to update",
		options: updates.map((u) => ({
			value: u.name,
			label: `${u.name} ${u.current}`,
			hint: u.type,
		})),
		required: false,
	});

	if (clack.isCancel(selectedPackages)) return "cancel";
	if (!selectedPackages || (selectedPackages as string[]).length === 0)
		return [];

	const result: {
		name: string;
		type: "cli" | "plugin";
		current: string;
		selectedVersion: VersionInfo;
	}[] = [];
	for (const pkgName of selectedPackages as string[]) {
		const pkg = updates.find((u) => u.name === pkgName);
		if (!pkg) continue;

		const { newestMature, immature } = partitionVersions(pkg.versions);
		const selectableVersions = newestMature
			? [newestMature, ...immature]
			: immature;

		const selectedVersion = await clack.select<VersionInfo>({
			message: `Select version for ${pkg.name}`,
			options: selectableVersions.map((v) => {
				const mature = isMature(v.ageSeconds);
				const label = mature
					? `${v.version} (${formatAge(v.ageSeconds)} old) ✓ ready`
					: `${v.version} (${formatAge(getMaturitySecs() - v.ageSeconds)} remaining) ⏳ waiting`;
				return {
					value: v,
					label,
				};
			}),
		});

		if (clack.isCancel(selectedVersion)) return "cancel";

		result.push({
			name: pkg.name,
			type: pkg.type,
			current: pkg.current,
			selectedVersion: selectedVersion as VersionInfo,
		});
	}

	return result;
}

const args = process.argv.slice(2);
const flagPreLaunch = args.includes("--pre-launch");
const flagUninstallHook = args.includes("--uninstall-hook");
const flagAll = args.includes("--all") || args.includes("-a");
const hasFlags = flagPreLaunch || flagUninstallHook || flagAll;

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

function launchOpencode(cliArgs: string[]): void {
	const child = spawn("opencode", cliArgs, { stdio: "inherit" });
	child.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}

export async function selectVersionsPreLaunch(
	updateCount: number,
): Promise<"install" | "skip" | "cancel"> {
	const choice = await clack.select<"install" | "skip">({
		message: `${updateCount} mature update(s) available. What would you like to do?`,
		options: [
			{
				value: "install",
				label: "Install mature updates and launch opencode",
				hint: "recommended",
			},
			{ value: "skip", label: "Skip updates and launch opencode" },
		],
	});
	if (clack.isCancel(choice)) return "cancel";
	return choice;
}

export async function runPreLaunch(opencodeArgs: string[]): Promise<void> {
	try {
		loadConfig();
		const detailedUpdates = await checkAllUpdates();
		const mature = detailedUpdates.filter(
			(u) => partitionVersions(u.versions).newestMature !== null,
		);
		if (mature.length === 0) {
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

	// Build version-grouped summary from detailed data
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

	clack.note(lines.join("\n"), "Available Updates");

	// --all flag: install all updates (including immature) without prompting
	if (flagAll) {
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
		return;
	}

	// Interactive selection — version-level grouping
	const selected = await selectVersions(detailedUpdates);

	if (selected === "cancel") {
		clack.cancel("Cancelled");
		return;
	}

	if (selected.length === 0) {
		clack.outro("No updates selected.");
		return;
	}

	// Convert to install items and check for immature versions
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

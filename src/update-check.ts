import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir, getMaturitySecs } from "./config.js";
import {
	execQuietAsync,
	getPublishedTimesAsync,
	readJsonc,
} from "./helpers.js";
import type { UpdateInfo } from "./types.js";

function semverGt(a: string, b: string): boolean {
	const aParts = a.split(".");
	const bParts = b.split(".");
	const len = Math.max(aParts.length, bParts.length);
	for (let i = 0; i < len; i++) {
		const aNum = Number(aParts[i] || 0);
		const bNum = Number(bParts[i] || 0);
		if (aNum > bNum) return true;
		if (aNum < bNum) return false;
	}
	return false;
}

export async function findBestUpdate(
	pkg: string,
	currentVersion: string,
	nowEpoch: number,
	maturitySecs: number,
): Promise<{ version: string; ageSeconds: number } | null> {
	const times = await getPublishedTimesAsync(pkg);
	if (!times) return null;

	const newerVersions = Object.entries(times).filter(([version]) =>
		semverGt(version, currentVersion),
	);

	if (newerVersions.length === 0) return null;

	let latestVersion = newerVersions[0][0];
	let latestEpoch = newerVersions[0][1];

	for (const [version, epoch] of newerVersions) {
		if (semverGt(version, latestVersion)) {
			latestVersion = version;
			latestEpoch = epoch;
		}
	}

	let matureVersion: string | null = null;
	let matureEpoch: number | null = null;

	for (const [version, epoch] of newerVersions) {
		if (nowEpoch - epoch >= maturitySecs) {
			if (!matureVersion || semverGt(version, matureVersion)) {
				matureVersion = version;
				matureEpoch = epoch;
			}
		}
	}

	if (matureVersion && matureEpoch !== null) {
		return { version: matureVersion, ageSeconds: nowEpoch - matureEpoch };
	}

	return { version: latestVersion, ageSeconds: nowEpoch - latestEpoch };
}

export async function checkForUpdates(
	directory: string,
): Promise<UpdateInfo[]> {
	const updates: UpdateInfo[] = [];
	const nowEpoch = Math.floor(Date.now() / 1000);
	const maturitySecs = getMaturitySecs();

	// 1. Check OpenCode CLI
	const currentCli = await execQuietAsync("opencode --version");
	if (currentCli) {
		const cliUpdate = await findBestUpdate(
			"opencode-ai",
			currentCli,
			nowEpoch,
			maturitySecs,
		);
		if (cliUpdate) {
			updates.push({
				type: "cli",
				name: "opencode",
				current: currentCli,
				latest: cliUpdate.version,
				ageSeconds: cliUpdate.ageSeconds,
			});
		}
	}

	// 2. Check package.json dependencies
	const pkgConfig = readJsonc(path.join(directory, "package.json"));
	const deps = (pkgConfig?.dependencies ?? {}) as Record<string, string>;
	for (const [name, version] of Object.entries(deps)) {
		const current = version.replace(/^[\^~>=<]+/, "");
		const pkgUpdate = await findBestUpdate(
			name,
			current,
			nowEpoch,
			maturitySecs,
		);
		if (pkgUpdate) {
			updates.push({
				type: "pkg",
				name,
				current,
				latest: pkgUpdate.version,
				ageSeconds: pkgUpdate.ageSeconds,
			});
		}
	}

	// 3. Check opencode.json plugins (global config, not project dir)
	const globalConfigDir = getConfigDir();
	let configPath = path.join(globalConfigDir, "opencode.json");
	if (!fs.existsSync(configPath)) {
		configPath = path.join(globalConfigDir, "opencode.jsonc");
	}
	const openCodeConfig = readJsonc(configPath);
	const plugins = (openCodeConfig?.plugin ?? []) as string[];

	for (const pluginRef of plugins) {
		const match = pluginRef.match(/^(@?[^@]+)@(.+)$/);
		if (!match) continue;
		const [, name, current] = match;
		const pluginUpdate = await findBestUpdate(
			name,
			current,
			nowEpoch,
			maturitySecs,
		);
		if (pluginUpdate) {
			updates.push({
				type: "plugin",
				name,
				current,
				latest: pluginUpdate.version,
				ageSeconds: pluginUpdate.ageSeconds,
			});
		}
	}

	return updates;
}

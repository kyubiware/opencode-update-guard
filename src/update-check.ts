import * as fs from "node:fs";
import * as path from "node:path";
import {
	execQuiet,
	getLatestVersion,
	getPublishedEpoch,
	readJsonc,
} from "./helpers.js";
import type { UpdateInfo } from "./types.js";

export function checkForUpdates(directory: string): UpdateInfo[] {
	const updates: UpdateInfo[] = [];
	const nowEpoch = Math.floor(Date.now() / 1000);

	// 1. Check OpenCode CLI
	const currentCli = execQuiet("opencode --version");
	if (currentCli) {
		const latestCli = getLatestVersion("opencode-ai");
		if (latestCli && currentCli !== latestCli) {
			const pubEpoch = getPublishedEpoch("opencode-ai", latestCli);
			updates.push({
				type: "cli",
				name: "opencode",
				current: currentCli,
				latest: latestCli,
				ageSeconds: pubEpoch ? nowEpoch - pubEpoch : -1,
			});
		}
	}

	// 2. Check package.json dependencies
	const pkgConfig = readJsonc(path.join(directory, "package.json"));
	const deps = (pkgConfig?.dependencies ?? {}) as Record<string, string>;
	for (const [name, version] of Object.entries(deps)) {
		const current = version.replace(/^[\^~>=<]+/, "");
		const latest = getLatestVersion(name);
		if (latest && current !== latest) {
			const pubEpoch = getPublishedEpoch(name, latest);
			updates.push({
				type: "pkg",
				name,
				current,
				latest,
				ageSeconds: pubEpoch ? nowEpoch - pubEpoch : -1,
			});
		}
	}

	// 3. Check opencode.json plugins
	let configPath = path.join(directory, "opencode.json");
	if (!fs.existsSync(configPath)) {
		configPath = path.join(directory, "opencode.jsonc");
	}
	const openCodeConfig = readJsonc(configPath);
	const plugins = (openCodeConfig?.plugin ?? []) as string[];

	for (const pluginRef of plugins) {
		const match = pluginRef.match(/^(@?[^@]+)@(.+)$/);
		if (!match) continue;
		const [, name, current] = match;
		const latest = getLatestVersion(name);
		if (latest && current !== latest) {
			const pubEpoch = getPublishedEpoch(name, latest);
			updates.push({
				type: "plugin",
				name,
				current,
				latest,
				ageSeconds: pubEpoch ? nowEpoch - pubEpoch : -1,
			});
		}
	}

	return updates;
}

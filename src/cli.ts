#!/usr/bin/env node

import { execSync } from "node:child_process";
import * as clack from "@clack/prompts";
import { getMaturitySecs, isMature, loadConfig } from "./config.js";
import { formatAge } from "./helpers.js";
import type { UpdateInfo } from "./types.js";
import { checkForUpdates } from "./update-check.js";

function installPackage(name: string, version: string, type: string): boolean {
	try {
		if (type === "cli") {
			execSync(`npm install -g opencode-ai@${version}`, { stdio: "pipe" });
		} else if (type === "plugin") {
			execSync(`npm install -g ${name}@${version}`, { stdio: "pipe" });
		}
		return true;
	} catch {
		return false;
	}
}

async function main() {
	clack.intro("Update Guard");

	const s = clack.spinner();
	s.start("Checking for updates...");

	loadConfig();
	const updates = checkForUpdates(process.cwd());

	s.stop(`Found ${updates.length} update(s)`);

	if (updates.length === 0) {
		clack.outro("All packages are up to date ✓");
		return;
	}

	const mature = updates.filter((u) => isMature(u.ageSeconds));
	const waiting = updates.filter((u) => !isMature(u.ageSeconds));

	// Build summary
	const lines: string[] = [];
	if (mature.length > 0) {
		lines.push(`  ${mature.length} update(s) ready to install:`);
		for (const u of mature) {
			lines.push(
				`    • ${u.name} ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`,
			);
		}
	}
	if (waiting.length > 0) {
		lines.push("");
		lines.push(`  ${waiting.length} update(s) waiting for maturity:`);
		const maturitySecs = getMaturitySecs();
		for (const u of waiting) {
			const remaining = maturitySecs - u.ageSeconds;
			lines.push(
				`    • ${u.name} ${u.current} → ${u.latest} (${formatAge(remaining)} remaining)`,
			);
		}
	}

	clack.note(lines.join("\n"), "Available Updates");

	if (mature.length === 0) {
		clack.outro("No mature updates available yet. Check back later.");
		return;
	}

	const selected = await clack.multiselect({
		message: "Select updates to install",
		options: mature.map((u) => ({
			value: u,
			label: `${u.name} ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`,
			hint: u.type,
		})),
		required: false,
	});

	if (clack.isCancel(selected)) {
		clack.cancel("Cancelled");
		return;
	}

	const toInstall = selected as UpdateInfo[];
	if (toInstall.length === 0) {
		clack.outro("No updates selected.");
		return;
	}

	// Install selected updates
	const installSpinner = clack.spinner();
	installSpinner.start("Installing updates...");
	let installed = 0;
	let failed = 0;

	for (const u of toInstall) {
		if (u.type === "pkg") {
			installSpinner.stop(`${u.name}: project dependency — skip`);
			clack.log.warn(
				`${u.name}: run \`npm update ${u.name}\` or \`bun update ${u.name}\` in the project to update.`,
			);
			installSpinner.start("Installing updates...");
			continue;
		}

		installSpinner.message(`Installing ${u.name}@${u.latest}...`);
		const success = installPackage(u.name, u.latest, u.type);
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

main().catch((err) => {
	clack.log.error(`Unexpected error: ${err}`);
	process.exit(1);
});

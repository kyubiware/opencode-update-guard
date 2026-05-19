#!/usr/bin/env bun

import { execSync } from "node:child_process";

const validBumps = ["patch", "minor", "major"] as const;
type BumpType = (typeof validBumps)[number];

const bump = (process.argv[2] ?? "patch") as BumpType;

if (!validBumps.includes(bump)) {
	console.error(`Invalid bump type: "${bump}". Use one of: ${validBumps.join(", ")}`);
	process.exit(1);
}

const dirty = execSync("git status --porcelain").toString().trim();
if (dirty) {
	console.error("Working tree is not clean. Commit or stash changes first.");
	process.exit(1);
}

const currentVersion = await Bun.file("package.json")
	.json()
	.then((p) => p.version as string);

console.log(`Current version: v${currentVersion}`);
console.log(`Bumping ${bump}...`);

const newVersion = execSync(`npm version ${bump} -m "release: v%s"`)
	.toString()
	.trim();

console.log(`Version bumped to ${newVersion}`);
console.log("Pushing commit and tag...");

execSync("git push", { stdio: "inherit" });
execSync(`git push origin ${newVersion}`, { stdio: "inherit" });

console.log(`Released ${newVersion}`);
console.log("https://github.com/kyubiware/opencode-update-guard/actions");

#!/usr/bin/env bun

const validBumps = ["patch", "minor", "major"] as const;
type BumpType = (typeof validBumps)[number];

const bump = (process.argv[2] ?? "patch") as BumpType;

if (!validBumps.includes(bump)) {
	console.error(`Invalid bump type: "${bump}". Use one of: ${validBumps.join(", ")}`);
	process.exit(1);
}

const currentVersion = await Bun.file("package.json")
	.json()
	.then((p) => p.version as string);

console.log(`Current version: v${currentVersion}`);
console.log(`Triggering ${bump} release...`);

const proc = Bun.spawn(
	[
		"gh",
		"workflow",
		"run",
		"release.yml",
		"--ref",
		"main",
		"-f",
		`bump_type=${bump}`,
	],
	{
		stdout: "inherit",
		stderr: "inherit",
	},
);

const exitCode = await proc.exited;

if (exitCode === 0) {
	console.log("Release workflow triggered successfully.");
	console.log("Monitor at: https://github.com/kyubiware/opencode-update-guard/actions");
} else {
	console.error(`Failed to trigger release (exit code ${exitCode})`);
	process.exit(exitCode);
}

import * as clack from "@clack/prompts";
import { getMaturitySecs, isMature } from "../config.js";
import { formatAge } from "../helpers.js";
import type { DetailedUpdateInfo, UpdateInfo, VersionInfo } from "../types.js";

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

export async function selectVersionsPreLaunch(
	matureUpdates: {
		name: string;
		current: string;
		selectedVersion: { version: string; ageSeconds: number };
	}[],
): Promise<"install" | "skip" | "cancel"> {
	const count = matureUpdates.length;
	const summary = matureUpdates
		.map(
			(u) =>
				`${u.name} ${u.current} → ${u.selectedVersion.version} (${formatAge(u.selectedVersion.ageSeconds)} old)`,
		)
		.join("\n");

	const choice = await clack.select<"install" | "skip">({
		message: `${count} mature update(s) available:\n${summary}\nWhat would you like to do?`,
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

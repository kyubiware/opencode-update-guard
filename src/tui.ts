/**
 * OpenCode Update Guard — TUI Plugin
 *
 * Shows a blocking dialog on startup when updates are available.
 * Reads update data written by the server plugin to a shared cache file.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	TuiPlugin,
	TuiPluginApi,
	TuiPluginMeta,
} from "@opencode-ai/plugin/tui";

// ── Shared Cache ──────────────────────────────────────────────

const UPDATE_CACHE_FILE = "update-guard-last-check";

interface CachedUpdates {
	timestamp: number;
	fingerprint: string;
	updates?: {
		name: string;
		current: string;
		latest: string;
		ageSeconds: number;
		mature: boolean;
	}[];
}

function getCacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	const base = xdg || path.join(os.homedir(), ".cache");
	return path.join(base, "opencode");
}

function readCachedUpdates(): CachedUpdates | null {
	try {
		const cachePath = path.join(getCacheDir(), UPDATE_CACHE_FILE);
		if (!fs.existsSync(cachePath)) return null;
		const raw = fs.readFileSync(cachePath, "utf-8").trim();
		return JSON.parse(raw) as CachedUpdates;
	} catch {
		return null;
	}
}

function formatAge(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

// ── TUI Plugin Entry Point ────────────────────────────────────

const updateGuardTui: TuiPlugin = async (
	api: TuiPluginApi,
	_options,
	_meta: TuiPluginMeta,
) => {
	const cache = readCachedUpdates();
	if (!cache?.updates || cache.updates.length === 0) return;

	const mature = cache.updates.filter((u) => u.mature);
	const waiting = cache.updates.filter((u) => !u.mature);

	if (mature.length === 0 && waiting.length === 0) return;

	const lines: string[] = [];

	if (mature.length > 0) {
		lines.push("Ready to install:");
		for (const u of mature) {
			lines.push(
				`  • ${u.name} ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`,
			);
		}
	}

	if (waiting.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Waiting for maturity:");
		for (const u of waiting) {
			lines.push(
				`  • ${u.name} ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`,
			);
		}
	}

	const message = lines.join("\n");

	// Show blocking dialog — user must acknowledge before continuing
	api.ui.dialog.replace(() => {
		const { DialogAlert } = api.ui;
		return DialogAlert({
			title: "Update Guard",
			message,
			onConfirm: () => {
				api.ui.dialog.clear();
			},
		});
	});
};

export default updateGuardTui;

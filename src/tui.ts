/**
 * OpenCode Update Guard — TUI Plugin
 *
 * Shows a blocking dialog on startup when mature updates are available.
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
import { isMature, loadConfig } from "./config.js";
import { debugLog } from "./debug.js";

// ── Shared Cache ──────────────────────────────────────────────

const UPDATE_CACHE_FILE = "update-guard-last-check";

interface CachedUpdate {
	name: string;
	current: string;
	latest: string;
	ageSeconds: number;
	mature: boolean;
}

interface CacheData {
	timestamp: number;
	fingerprint: string;
	updates?: CachedUpdate[];
}

function getCacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	const base = xdg || path.join(os.homedir(), ".cache");
	return path.join(base, "opencode");
}

function readCachedUpdates(): CachedUpdate[] {
	try {
		const cachePath = path.join(getCacheDir(), UPDATE_CACHE_FILE);
		if (!fs.existsSync(cachePath)) return [];
		const raw = fs.readFileSync(cachePath, "utf-8").trim();
		const data: CacheData = JSON.parse(raw);
		return data.updates || [];
	} catch {
		return [];
	}
}

// ── Dialog State ──────────────────────────────────────────────

let dialogShown = false;

function showDialogIfNeeded(api: TuiPluginApi): void {
	if (dialogShown) return;

	const updates = readCachedUpdates();
	if (updates.length === 0) return;

	loadConfig();
	const mature = updates.filter((u) => isMature(u.ageSeconds));
	if (mature.length === 0) return;

	dialogShown = true;
	debugLog("tui: showing dialog for", mature.length, "mature updates");

	const lines = mature.map((u) => `  • ${u.name} ${u.current} → ${u.latest}`);

	api.ui.dialog.replace(() =>
		api.ui.DialogConfirm({
			title: "Update Guard — Updates Available",
			message: `${mature.length} update(s) ready to install:\n\n${lines.join("\n")}\n\nDismiss to continue.`,
			onCancel: () => {
				api.ui.dialog.clear();
			},
			onConfirm: () => {
				api.ui.dialog.clear();
			},
		}),
	);
}

// ── TUI Plugin Entry Point ────────────────────────────────────

const updateGuardTui: TuiPlugin = async (
	api: TuiPluginApi,
	_options,
	_meta: TuiPluginMeta,
) => {
	api.event.on("session.created", async () => {
		showDialogIfNeeded(api);
	});

	api.event.on("session.updated", async () => {
		showDialogIfNeeded(api);
	});
};

export default { tui: updateGuardTui };

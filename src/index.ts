/**
 * OpenCode Update Guard Plugin
 *
 * Checks for dependency updates with a maturity cooldown on session start.
 * Writes update results to a shared cache for the TUI plugin to display.
 */

import type { Hooks, Plugin, PluginOptions } from "@opencode-ai/plugin";
import type { OpencodeClient, Part } from "@opencode-ai/sdk";
import {
	ensureConfigFile,
	getMaturitySecs,
	isMature,
	loadConfig,
} from "./config.js";
import { markChecked, shouldCheck } from "./cooldown.js";
import { debugLog } from "./debug.js";
import { formatAge } from "./helpers.js";
import { buildUpdateReport } from "./report.js";
import type { UpdateInfo } from "./types.js";
import { checkForUpdates } from "./update-check.js";

// ── Plugin State ───────────────────────────────────────────────

const blockedPackages = new Map<string, UpdateInfo>();
let client: OpencodeClient;
let lastReport = "";
let updateCheckDone = false;

// ── Toast ──────────────────────────────────────────────────────

function showToast(options: {
	title?: string;
	message: string;
	variant: "info" | "success" | "warning" | "error";
	duration?: number;
}): void {
	client?.tui.showToast({ body: options }).catch(() => {
		/* TUI may not be ready */
	});
}

// ── Plugin Entry Point ─────────────────────────────────────────

const updateGuardPlugin: Plugin = async (input, _options?: PluginOptions) => {
	const { client: inputClient, directory } = input;
	client = inputClient;

	ensureConfigFile();
	loadConfig();
	debugLog("plugin loaded, directory:", directory);
	updateCheckDone = false;

	const hooks: Hooks = {
		event: async ({ event }) => {
			try {
				debugLog("event received:", event.type);
				if (
					event.type !== "session.created" &&
					event.type !== "session.updated"
				)
					return;

				debugLog("session event matched, updateCheckDone:", updateCheckDone);
				if (updateCheckDone) return;
				updateCheckDone = true;

				// Only check once per day
				const should = shouldCheck();
				debugLog("shouldCheck:", should);
				if (!should) return;

				debugLog("checking for updates, directory:", directory);
				const updates = checkForUpdates(directory);
				debugLog(
					"updates found:",
					updates.length,
					JSON.stringify(
						updates.map(
							(u) => `${u.name} ${u.current}->${u.latest} age=${u.ageSeconds}s`,
						),
					),
				);

				if (updates.length === 0) {
					markChecked();
					return;
				}

				// Build and store the report for system transform
				const report = buildUpdateReport(updates);
				lastReport = report;

				debugLog("writing update cache for TUI plugin");
				markChecked(undefined, updates);

				// Populate blocked packages from the updates found
				const waiting = updates.filter(
					(u) => u.ageSeconds >= 0 && !isMature(u.ageSeconds),
				);
				for (const u of waiting) {
					blockedPackages.set(u.name, u);
				}
				// Clean up packages that are now mature
				for (const [name, info] of blockedPackages) {
					if (isMature(info.ageSeconds)) {
						blockedPackages.delete(name);
					}
				}
			} catch (err) {
				debugLog("ERROR in event handler:", err);
			}
		},

		"permission.ask": async (input, output) => {
			const title = (input.title || "").toLowerCase();
			const pattern = input.pattern;
			const patterns = Array.isArray(pattern)
				? pattern
				: pattern
					? [pattern]
					: [];
			const allText = [title, ...patterns].join(" ").toLowerCase();

			for (const [name, info] of blockedPackages) {
				if (allText.includes(name.toLowerCase())) {
					output.status = "deny";
					showToast({
						title: "Update Guard",
						message: `Blocked update to ${name} ${info.latest} — ${formatAge(info.ageSeconds)} old, needs ${formatAge(getMaturitySecs() - info.ageSeconds)} more to mature.`,
						variant: "warning",
						duration: 8000,
					});
					return;
				}
			}
		},

		"command.execute.before": async (input, output) => {
			const cmd = (input.command || "").toLowerCase();
			const args = (input.arguments || "").toLowerCase();
			const full = `${cmd} ${args}`;

			const updatePatterns = [
				/\bnpm\s+(install|i|update|upgrade)\b/,
				/\bbun\s+(install|i|update|upgrade|add)\b/,
				/\byarn\s+(install|add|upgrade)\b/,
				/\bpnpm\s+(install|i|add|update|upgrade)\b/,
			];

			const isUpdate = updatePatterns.some((p) => p.test(full));
			if (!isUpdate) return;

			for (const [name, info] of blockedPackages) {
				if (full.includes(name.toLowerCase())) {
					const warning = `⚠️ Update Guard: ${name} ${info.latest} is only ${formatAge(info.ageSeconds)} old (needs ${formatAge(getMaturitySecs() - info.ageSeconds)} more to mature). This update is BLOCKED.`;
					(output.parts as unknown[]).push({
						type: "text",
						text: warning,
					} as unknown as Part);
					return;
				}
			}
		},

		"experimental.chat.system.transform": async (_input, output) => {
			if (blockedPackages.size === 0 && !lastReport) return;

			const lines: string[] = [];

			if (lastReport) {
				lines.push("[Update Guard] Update status:");
				lines.push(lastReport);
				lines.push("");
			}

			if (blockedPackages.size > 0) {
				lines.push(
					"[Update Guard] The following packages have IMMATURE updates that MUST NOT be installed:",
				);
				for (const [name, info] of blockedPackages) {
					lines.push(
						`- ${name}: ${info.latest} (published ${formatAge(info.ageSeconds)} ago, needs ${formatAge(getMaturitySecs() - info.ageSeconds)} more)`,
					);
				}
				lines.push(
					"Do NOT suggest, run, or assist with installing these versions until they mature.",
				);
			}

			output.system.push(lines.join("\n"));
		},
	};

	return hooks;
};

export default updateGuardPlugin;

/**
 * OpenCode Update Guard Plugin
 *
 * Checks for dependency updates with a maturity cooldown on session start.
 * Notifies the user and prompts to install mature updates.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hooks, Plugin, PluginOptions } from "@opencode-ai/plugin";
import type { OpencodeClient, Part } from "@opencode-ai/sdk";

// ── Configuration ──────────────────────────────────────────────

const DEFAULT_MATURITY_DAYS = 3;
const COOLDOWN_FILE = "update-guard-last-check";
const CONFIG_FILENAME = "update-guard.jsonc";

let maturityDays = DEFAULT_MATURITY_DAYS;
let maturitySecs = maturityDays * 86400;

const blockedPackages = new Map<string, UpdateInfo>();
let client: OpencodeClient;
let lastReport = "";

// ── Types ──────────────────────────────────────────────────────

interface UpdateInfo {
	type: "cli" | "pkg" | "plugin";
	name: string;
	current: string;
	latest: string;
	ageSeconds: number;
}

// ── Helpers ────────────────────────────────────────────────────

function execQuiet(cmd: string): string {
	try {
		return execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "";
	}
}

function getLatestVersion(pkg: string): string | null {
	const result = execQuiet(`npm view ${pkg} version`);
	return result || null;
}

function getPublishedEpoch(pkg: string, version: string): number | null {
	const result = execQuiet(`npm view ${pkg} time --json`);
	if (!result) return null;
	try {
		const times = JSON.parse(result) as Record<string, string>;
		const iso = times[version];
		if (!iso) return null;
		return Math.floor(new Date(iso).getTime() / 1000);
	} catch {
		return null;
	}
}

function formatAge(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function isMature(ageSeconds: number): boolean {
	return ageSeconds >= maturitySecs;
}

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

function parseJsonc(content: string): unknown {
	let result = "";
	let i = 0;
	let inString = false;
	let escaped = false;

	while (i < content.length) {
		const ch = content[i];
		if (escaped) {
			result += ch;
			escaped = false;
			i++;
			continue;
		}
		if (ch === "\\") {
			result += ch;
			escaped = true;
			i++;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			result += ch;
			i++;
			continue;
		}
		if (inString) {
			result += ch;
			i++;
			continue;
		}
		if (ch === "/" && content[i + 1] === "/") {
			while (i < content.length && content[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && content[i + 1] === "*") {
			i += 2;
			while (
				i < content.length &&
				!(content[i] === "*" && content[i + 1] === "/")
			)
				i++;
			i += 2;
			continue;
		}
		result += ch;
		i++;
	}

	return JSON.parse(result);
}

function readJsonc(filePath: string): Record<string, unknown> | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		const content = fs.readFileSync(filePath, "utf-8");
		return parseJsonc(content) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function _writeJson(filePath: string, data: Record<string, unknown>): void {
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function getConfigDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg || path.join(os.homedir(), ".config");
	return path.join(base, "opencode");
}

function loadConfig(): void {
	const configPath = path.join(getConfigDir(), CONFIG_FILENAME);
	const raw = readJsonc(configPath);

	const value = raw?.maturityDays;
	if (typeof value === "number" && value >= 0 && Number.isFinite(value)) {
		maturityDays = value;
	} else {
		maturityDays = DEFAULT_MATURITY_DAYS;
	}
	maturitySecs = maturityDays * 86400;
}

function ensureConfigFile(): void {
	try {
		const configDir = getConfigDir();
		const configPath = path.join(configDir, CONFIG_FILENAME);

		if (fs.existsSync(configPath)) return;

		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}

		const content = `{
  // Minimum age (in days) a package version must be before it's considered
  // "mature" enough to install. This cooldown helps protect against supply
  // chain attacks on newly published packages.
  "maturityDays": ${DEFAULT_MATURITY_DAYS}
}
`;
		fs.writeFileSync(configPath, content);
	} catch {
		// non-critical — will use defaults
	}
}

// ── Update Check ───────────────────────────────────────────────

function checkForUpdates(directory: string): UpdateInfo[] {
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

function buildUpdateReport(updates: UpdateInfo[]): string {
	const lines: string[] = [];
	const mature = updates.filter((u) => u.ageSeconds >= maturitySecs);
	const waiting = updates.filter(
		(u) => u.ageSeconds >= 0 && u.ageSeconds < maturitySecs,
	);
	const unknown = updates.filter((u) => u.ageSeconds < 0);

	lines.push(`**Update Guard** — ${maturityDays}-day maturity cooldown`);
	lines.push("");

	if (mature.length > 0) {
		lines.push("**Ready to install:**");
		for (const u of mature) {
			lines.push(
				`  - \`${u.name}\` ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old)`,
			);
		}
		lines.push("");
	}

	if (waiting.length > 0) {
		lines.push("**Waiting for maturity:**");
		for (const u of waiting) {
			const remaining = formatAge(maturitySecs - u.ageSeconds);
			lines.push(
				`  - \`${u.name}\` ${u.current} → ${u.latest} (${formatAge(u.ageSeconds)} old, ${remaining} remaining)`,
			);
		}
		lines.push("");
	}

	if (unknown.length > 0) {
		lines.push("**Age unknown:**");
		for (const u of unknown) {
			lines.push(`  - \`${u.name}\` ${u.current} → ${u.latest}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ── Cooldown (check once per day) ──────────────────────────────

function getCacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	const base = xdg || path.join(os.homedir(), ".cache");
	return path.join(base, "opencode");
}

function shouldCheck(): boolean {
	try {
		const cachePath = path.join(getCacheDir(), COOLDOWN_FILE);
		if (!fs.existsSync(cachePath)) return true;
		const lastCheck = parseInt(fs.readFileSync(cachePath, "utf-8").trim(), 10);
		const hoursSince = (Date.now() - lastCheck) / 3600000;
		return hoursSince >= 24;
	} catch {
		return true;
	}
}

function markChecked(): void {
	try {
		const cacheDir = getCacheDir();
		if (!fs.existsSync(cacheDir)) {
			fs.mkdirSync(cacheDir, { recursive: true });
		}
		fs.writeFileSync(path.join(cacheDir, COOLDOWN_FILE), String(Date.now()));
	} catch {
		// non-critical
	}
}

// ── Plugin Entry Point ─────────────────────────────────────────

const updateGuardPlugin: Plugin = async (input, _options?: PluginOptions) => {
	const { client: inputClient, directory } = input;
	client = inputClient;

	ensureConfigFile();
	loadConfig();

	const hooks: Hooks = {
		event: async ({ event }) => {
			if (event.type === "installation.update-available") {
				const props = event.properties;
				const version = props.version as string | undefined;
				if (version) {
					const pubEpoch = getPublishedEpoch("opencode-ai", version);
					const nowEpoch = Math.floor(Date.now() / 1000);
					const ageSeconds = pubEpoch ? nowEpoch - pubEpoch : -1;
					if (ageSeconds >= 0 && !isMature(ageSeconds)) {
						blockedPackages.set("opencode", {
							type: "cli",
							name: "opencode",
							current: "",
							latest: version,
							ageSeconds,
						});
						showToast({
							title: "Update Guard",
							message: `opencode ${version} published ${formatAge(ageSeconds)} ago — blocked until mature (${formatAge(maturitySecs - ageSeconds)} remaining).`,
							variant: "warning",
							duration: 8000,
						});
					}
				}
			}

			if (event.type !== "session.created") return;

			// Only check once per day
			if (!shouldCheck()) return;

			const updates = checkForUpdates(directory);
			markChecked();

			if (updates.length === 0) return;

			// Build and store the report for system transform
			const report = buildUpdateReport(updates);
			lastReport = report;

			const mature = updates.filter((u) => isMature(u.ageSeconds));
			if (mature.length > 0) {
				showToast({
					title: "Update Guard",
					message: `${mature.length} update(s) ready to install out of ${updates.length} available. Run \`bun run update\` in ${directory} to install.`,
					variant: "info",
					duration: 10000,
				});
			} else {
				const waiting = updates.filter(
					(u) => u.ageSeconds >= 0 && u.ageSeconds < maturitySecs,
				);
				if (waiting.length > 0) {
					showToast({
						title: "Update Guard",
						message: `${waiting.length} update(s) waiting for ${maturityDays}-day maturity cooldown.`,
						variant: "info",
						duration: 6000,
					});
				}
			}

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
						message: `Blocked update to ${name} ${info.latest} — ${formatAge(info.ageSeconds)} old, needs ${formatAge(maturitySecs - info.ageSeconds)} more to mature.`,
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
					const warning = `⚠️ Update Guard: ${name} ${info.latest} is only ${formatAge(info.ageSeconds)} old (needs ${formatAge(maturitySecs - info.ageSeconds)} more to mature). This update is BLOCKED.`;
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
						`- ${name}: ${info.latest} (published ${formatAge(info.ageSeconds)} ago, needs ${formatAge(maturitySecs - info.ageSeconds)} more)`,
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

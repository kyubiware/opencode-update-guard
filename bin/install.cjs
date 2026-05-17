#!/usr/bin/env node

/**
 * Update Guard Plugin Installer
 *
 * Registers the plugin in the user's opencode.json config.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CONFIG_DIR =
	process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config", "opencode");
const PLUGIN_NAME = "opencode-update-guard";
const TUI_PLUGIN_NAME = `${PLUGIN_NAME}/tui`;
const PLUGIN_VERSION = JSON.parse(
	fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
).version;
const PLUGIN_ID = `${PLUGIN_NAME}@${PLUGIN_VERSION}`;
const TUI_PLUGIN_ID = `${TUI_PLUGIN_NAME}@${PLUGIN_VERSION}`;

function findConfigFile() {
	for (const name of ["opencode.json", "opencode.jsonc"]) {
		const p = path.join(CONFIG_DIR, name);
		if (fs.existsSync(p)) return p;
	}
	return path.join(CONFIG_DIR, "opencode.json");
}

function isRegistered(config) {
	return (config.plugin || []).some(
		(p) =>
			typeof p === "string" &&
			(p.startsWith(`${PLUGIN_NAME}@`) || p.startsWith(`${TUI_PLUGIN_NAME}@`)),
	);
}

function parseJsonc(content) {
	// Strip single-line comments (but not inside strings)
	// Strip multi-line comments (but not inside strings)
	// Then parse as JSON with tab tolerance
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

		// Single-line comment
		if (ch === "/" && content[i + 1] === "/") {
			while (i < content.length && content[i] !== "\n") i++;
			continue;
		}

		// Multi-line comment
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

function registerPlugin(config, name, id) {
	const existingIdx = config.plugin.findIndex(
		(p) => typeof p === "string" && p.startsWith(`${name}@`),
	);

	if (existingIdx !== -1) {
		if (config.plugin[existingIdx] === id) {
			console.log(
				`  ⊙ ${id} already registered in ${path.basename(findConfigFile())}`,
			);
			return;
		}
		config.plugin[existingIdx] = id;
		console.log(`  ↑ Updated to ${id} in ${path.basename(findConfigFile())}`);
	} else {
		config.plugin.push(id);
		console.log(`  ✓ Registered ${id} in ${path.basename(findConfigFile())}`);
	}
}

function register(configPath) {
	let config;

	if (fs.existsSync(configPath)) {
		const content = fs.readFileSync(configPath, "utf-8");
		config = parseJsonc(content);
	} else {
		config = {};
	}

	if (!config.plugin) config.plugin = [];

	registerPlugin(config, PLUGIN_NAME, PLUGIN_ID);
	registerPlugin(config, TUI_PLUGIN_NAME, TUI_PLUGIN_ID);

	// Disable OpenCode's built-in autoupdate so this plugin
	// becomes the sole update authority with maturity gating
	config.autoupdate = false;

	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function unregister(configPath) {
	if (!fs.existsSync(configPath)) return;

	const content = fs.readFileSync(configPath, "utf-8");
	const config = parseJsonc(content);

	if (!isRegistered(config)) {
		console.log(`  \u2299 ${PLUGIN_NAME} not found in config`);
		return;
	}

	config.plugin = (config.plugin || []).filter(
		(p) =>
			!(
				typeof p === "string" &&
				(p.startsWith(`${PLUGIN_NAME}@`) || p.startsWith(`${TUI_PLUGIN_NAME}@`))
			),
	);

	// Restore autoupdate since our plugin is no longer managing updates
	config.autoupdate = true;

	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	console.log(`  \u2713 Unregistered ${PLUGIN_NAME}`);
}

// ── Main ───────────────────────────────────────────────────────

const command = process.argv[2];

if (command === "uninstall") {
	unregister(findConfigFile());
} else {
	register(findConfigFile());
}

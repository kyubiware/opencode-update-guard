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

function findConfigFile() {
	for (const name of ["opencode.json", "opencode.jsonc"]) {
		const p = path.join(CONFIG_DIR, name);
		if (fs.existsSync(p)) return p;
	}
	return path.join(CONFIG_DIR, "opencode.json");
}

function isRegistered(config) {
	return (config.plugin || []).some(
		(p) => typeof p === "string" && p.startsWith(PLUGIN_NAME),
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

function register(configPath) {
	let config;

	if (fs.existsSync(configPath)) {
		const content = fs.readFileSync(configPath, "utf-8");
		config = parseJsonc(content);
	} else {
		config = {};
	}

	if (isRegistered(config)) {
		console.log(
			"  \u2299 " +
				PLUGIN_NAME +
				" already registered in " +
				path.basename(configPath),
		);
		return;
	}

	if (!config.plugin) config.plugin = [];
	config.plugin.push(PLUGIN_NAME);

	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	console.log(
		`  \u2713 Registered ${PLUGIN_NAME} in ${path.basename(configPath)}`,
	);
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
		(p) => !(typeof p === "string" && p.startsWith(PLUGIN_NAME)),
	);
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

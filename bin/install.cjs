#!/usr/bin/env node

/**
 * Update Guard Postinstall — Disables OpenCode autoupdate
 *
 * Sets autoupdate: false in the user's opencode.json config.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CONFIG_DIR =
	process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config", "opencode");

function findConfigFile() {
	for (const name of ["opencode.json", "opencode.jsonc"]) {
		const p = path.join(CONFIG_DIR, name);
		if (fs.existsSync(p)) return p;
	}
	return path.join(CONFIG_DIR, "opencode.json");
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

// ── Main ───────────────────────────────────────────────────────
const configPath = findConfigFile();

try {
	let config;
	if (fs.existsSync(configPath)) {
		config = parseJsonc(fs.readFileSync(configPath, "utf-8"));
	} else {
		config = {};
	}

	if (config.autoupdate === false) {
		console.log("  \u2299 autoupdate already disabled in opencode config");
	} else {
		config.autoupdate = false;
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
		console.log("  \u2713 Disabled autoupdate in opencode config");
	}
} catch (err) {
	console.log(`  \u26A0 Could not update config: ${err.message}`);
}

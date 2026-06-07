#!/usr/bin/env node
/**
 * Generates update-guard.schema.json from the config defaults in src/config.ts.
 * Run via: node bin/generate-schema.cjs
 *
 * Exits with code 1 if the generated schema differs from the committed one,
 * which catches cases where config options were added/changed without regenerating.
 */

const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(__dirname, "..", "update-guard.schema.json");

const schema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	$id: "https://github.com/kyubiware/opencode-update-guard/update-guard.schema.json",
	title: "Update Guard Configuration",
	description:
		"Configuration for opencode-update-guard. Place at ~/.config/opencode/update-guard.jsonc",
	type: "object",
	properties: {
		maturityDays: {
			type: "number",
			description:
				"Minimum age (in days) a package version must be published before it's considered safe to install. Higher values provide more protection against supply chain attacks but delay updates.",
			default: 3,
			minimum: 0,
			examples: [2, 3, 7],
		},
		debug: {
			type: "boolean",
			description:
				"Enable debug logging to troubleshoot update guard issues. Logs are written to $XDG_CACHE_HOME/opencode/update-guard-debug.log. View with: npm run logs",
			default: false,
		},
		autoupdateDismissed: {
			type: "boolean",
			description:
				"When true, suppresses the autoupdate prompt at startup. Set automatically when you choose 'don't ask again' in the interactive prompt.",
			default: false,
		},
	},
	additionalProperties: false,
};

const generated = `${JSON.stringify(schema, null, 2)}\n`;

const existing = fs.existsSync(schemaPath)
	? fs.readFileSync(schemaPath, "utf-8")
	: null;

if (existing !== generated) {
	fs.writeFileSync(schemaPath, generated);
	console.log("update-guard.schema.json regenerated.");
	process.exit(1);
}

console.log("update-guard.schema.json is up to date.");

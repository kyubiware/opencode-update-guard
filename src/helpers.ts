import { execSync } from "node:child_process";
import * as fs from "node:fs";

export function execQuiet(cmd: string): string {
	try {
		return execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "";
	}
}

export function getLatestVersion(pkg: string): string | null {
	const result = execQuiet(`npm view ${pkg} version`);
	return result || null;
}

export function getPublishedEpoch(pkg: string, version: string): number | null {
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

export function formatAge(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

export function parseJsonc(content: string): unknown {
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

export function readJsonc(filePath: string): Record<string, unknown> | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		const content = fs.readFileSync(filePath, "utf-8");
		return parseJsonc(content) as Record<string, unknown>;
	} catch {
		return null;
	}
}

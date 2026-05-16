import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDebugEnabled } from "./config.js";

export function getDebugLogPath(): string {
	const cacheDir =
		process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
	return path.join(cacheDir, "opencode", "update-guard-debug.log");
}

export function debugLog(...args: unknown[]): void {
	if (!isDebugEnabled()) return;
	try {
		const logPath = getDebugLogPath();
		const logDir = path.dirname(logPath);
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}
		const timestamp = new Date().toISOString();
		const line = `[${timestamp}] ${args.join(" ")}\n`;
		fs.appendFileSync(logPath, line);
	} catch {
		// best effort
	}
}

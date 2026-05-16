import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const COOLDOWN_FILE = "update-guard-last-check";

function getCacheDir(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	const base = xdg || path.join(os.homedir(), ".cache");
	return path.join(base, "opencode");
}

export function shouldCheck(): boolean {
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

export function markChecked(): void {
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

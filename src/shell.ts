import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ShellInfo {
	type: "bash" | "zsh" | "fish";
	configPath: string;
}

const SHELL_MARKER = "# opencode-update-guard pre-launch wrapper";

const SHELL_CONFIG_MAP: Record<
	string,
	{ type: ShellInfo["type"]; configFile: string }
> = {
	bash: { type: "bash", configFile: ".bashrc" },
	zsh: { type: "zsh", configFile: ".zshrc" },
	fish: { type: "fish", configFile: ".config/fish/config.fish" },
};

function getShellName(): string | null {
	const shellPath = process.env.SHELL;
	if (shellPath) {
		const name = path.basename(shellPath);
		if (name in SHELL_CONFIG_MAP) return name;
		return null;
	}
	// Fallback: check parent process
	try {
		const parentShell = execSync("ps -o comm= -p $PPID", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (parentShell in SHELL_CONFIG_MAP) return parentShell;
		return null;
	} catch {
		return null;
	}
}

export function detectShell(): ShellInfo | null {
	if (process.platform === "win32") return null;

	const shellName = getShellName();
	if (!shellName) return null;

	const entry = SHELL_CONFIG_MAP[shellName];
	if (!entry) return null;

	return {
		type: entry.type,
		configPath: path.join(os.homedir(), entry.configFile),
	};
}

export function isHookInstalled(
	_shellType: "bash" | "zsh" | "fish",
	configPath: string,
): boolean {
	if (!fs.existsSync(configPath)) return false;
	const content = fs.readFileSync(configPath, "utf-8");
	return content.includes(SHELL_MARKER);
}

function getHookContent(shellType: "bash" | "zsh" | "fish"): string {
	const lines: string[] = [SHELL_MARKER];
	if (shellType === "fish") {
		lines.push("function opencode");
		lines.push("    opencode-update --pre-launch $argv");
		lines.push("end");
	} else {
		lines.push("opencode() {");
		lines.push('    opencode-update --pre-launch "$@"');
		lines.push("}");
	}
	return lines.join("\n");
}

export function installHook(
	shellType: "bash" | "zsh" | "fish",
	configPath: string,
): void {
	const hook = getHookContent(shellType);

	if (fs.existsSync(configPath)) {
		const content = fs.readFileSync(configPath, "utf-8");
		if (content.includes(SHELL_MARKER)) return;
		fs.writeFileSync(configPath, `${content}\n\n${hook}\n`);
	} else {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, `${hook}\n`);
	}
}

export function uninstallHook(
	shellType: "bash" | "zsh" | "fish",
	configPath: string,
): void {
	if (!fs.existsSync(configPath)) return;

	const content = fs.readFileSync(configPath, "utf-8");
	const lines = content.split("\n");
	const markerIndex = lines.findIndex((l) => l.includes(SHELL_MARKER));
	if (markerIndex === -1) return;

	// Find the closing boundary
	let endIndex = markerIndex;
	if (shellType === "fish") {
		for (let i = markerIndex; i < lines.length; i++) {
			if (lines[i].trim() === "end") {
				endIndex = i;
				break;
			}
		}
	} else {
		for (let i = markerIndex; i < lines.length; i++) {
			if (lines[i].trim() === "}") {
				endIndex = i;
				break;
			}
		}
	}

	const newLines = [
		...lines.slice(0, markerIndex),
		...lines.slice(endIndex + 1),
	];
	fs.writeFileSync(configPath, newLines.join("\n"));
}

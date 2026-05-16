import { getMaturityDays, getMaturitySecs } from "./config.js";
import { formatAge } from "./helpers.js";
import type { UpdateInfo } from "./types.js";

export function buildUpdateReport(updates: UpdateInfo[]): string {
	const lines: string[] = [];
	const maturitySecs = getMaturitySecs();
	const mature = updates.filter((u) => u.ageSeconds >= maturitySecs);
	const waiting = updates.filter(
		(u) => u.ageSeconds >= 0 && u.ageSeconds < maturitySecs,
	);
	const unknown = updates.filter((u) => u.ageSeconds < 0);

	lines.push(`**Update Guard** — ${getMaturityDays()}-day maturity cooldown`);
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

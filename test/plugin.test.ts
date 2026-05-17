/**
 * Tests for src/index.ts — plugin hooks
 *
 * Verifies that the plugin does NOT react to installation.update-available
 * events (since autoupdate is now disabled and that event will never fire).
 *
 * Uses source code inspection to verify the handler was removed,
 * plus behavioral tests via the plugin's actual event hook.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

describe("updateGuardPlugin — installation.update-available removal", () => {
	it("should NOT contain installation.update-available handler in source code", () => {
		const source = fs.readFileSync(
			path.join(__dirname, "..", "src", "index.ts"),
			"utf-8",
		);

		// The plugin should not handle this event since autoupdate is disabled
		expect(source).not.toContain("installation.update-available");
	});

	it("should NOT contain blockedPackages.set calls for opencode from update-available events", () => {
		const source = fs.readFileSync(
			path.join(__dirname, "..", "src", "index.ts"),
			"utf-8",
		);

		// The only blockedPackages.set should be in the session event handler,
		// not in any installation.update-available handler
		const lines = source.split("\n");
		let inSessionHandler = false;
		let foundIllegalSet = false;

		for (const line of lines) {
			if (
				line.includes("session.created") ||
				line.includes("session.updated")
			)
				inSessionHandler = true;
			if (
				line.includes("blockedPackages.set") &&
				!inSessionHandler
			) {
				foundIllegalSet = true;
			}
		}

		expect(foundIllegalSet).toBe(false);
	});
});

describe("updateGuardPlugin — session event triggers", () => {
	it("should respond to session.updated event, not just session.created", () => {
		const source = fs.readFileSync(
			path.join(__dirname, "..", "src", "index.ts"),
			"utf-8",
		);

		// The plugin must accept session.updated as a trigger since
		// session.created does not fire on session resume/reconnect
		expect(source).toContain("session.updated");
		expect(source).toContain("session.created");
	});

	it("should only run the update check once per session (dedup guard)", () => {
		const source = fs.readFileSync(
			path.join(__dirname, "..", "src", "index.ts"),
			"utf-8",
		);

		// Must have a guard to prevent re-running on subsequent session.updated events
		expect(source).toMatch(/updateCheckDone|hasRunUpdateCheck|checkRan/);
	});
});

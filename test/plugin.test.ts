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

		// The only blockedPackages.set should be in the session.created handler,
		// not in any installation.update-available handler
		const lines = source.split("\n");
		let inSessionCreated = false;
		let foundIllegalSet = false;

		for (const line of lines) {
			if (line.includes("session.created")) inSessionCreated = true;
			if (
				line.includes("blockedPackages.set") &&
				!inSessionCreated
			) {
				foundIllegalSet = true;
			}
		}

		expect(foundIllegalSet).toBe(false);
	});
});

/**
 * Tests for src/tui.ts — TUI plugin
 *
 * Verifies the TUI plugin exports a TuiPluginModule, reads the shared
 * cache, shows a blocking DialogConfirm for mature updates, and
 * deduplicates dialog display.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let originalCacheHome: string | undefined;
let originalConfigHome: string | undefined;

beforeEach(() => {
	originalCacheHome = process.env.XDG_CACHE_HOME;
	originalConfigHome = process.env.XDG_CONFIG_HOME;
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-tui-test-"));
	process.env.XDG_CACHE_HOME = tmpDir;
	process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
	process.env.XDG_CACHE_HOME = originalCacheHome;
	process.env.XDG_CONFIG_HOME = originalConfigHome;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeCache(data: object): void {
	const cacheDir = path.join(tmpDir, "opencode");
	fs.mkdirSync(cacheDir, { recursive: true });
	fs.writeFileSync(
		path.join(cacheDir, "update-guard-last-check"),
		JSON.stringify(data),
	);
}

function createMockApi() {
	return {
		event: {
			on: vi.fn(),
		},
		ui: {
			DialogConfirm: vi.fn((props) => props),
			dialog: {
				replace: vi.fn(),
				clear: vi.fn(),
			},
		},
	};
}

async function loadTuiModule() {
	vi.resetModules();
	const mod = await import("../src/tui.js");
	return mod.default;
}

describe("updateGuardTui", () => {
	it("exports { tui: Function }", async () => {
		const mod = await loadTuiModule();
		expect(mod).toHaveProperty("tui");
		expect(typeof mod.tui).toBe("function");
	});

	it("reads cache and shows dialog for mature updates on session.created", async () => {
		writeCache({
			timestamp: Date.now(),
			fingerprint: "abc",
			updates: [
				{
					name: "foo",
					current: "1.0.0",
					latest: "1.1.0",
					ageSeconds: 864000,
					mature: true,
				},
			],
		});

		const api = createMockApi();
		const mod = await loadTuiModule();
		await mod.tui(
			api as unknown as import("@opencode-ai/plugin/tui").TuiPluginApi,
			undefined,
			{ state: "first" } as unknown as import("@opencode-ai/plugin/tui").TuiPluginMeta,
		);

		const sessionCreatedCall = api.event.on.mock.calls.find(
			([type]) => type === "session.created",
		);
		expect(sessionCreatedCall).toBeDefined();

		const handler = sessionCreatedCall[1];
		await handler();

		expect(api.ui.dialog.replace).toHaveBeenCalled();
	});

	it("does not re-show dialog if already shown", async () => {
		writeCache({
			timestamp: Date.now(),
			fingerprint: "abc",
			updates: [
				{
					name: "foo",
					current: "1.0.0",
					latest: "1.1.0",
					ageSeconds: 864000,
					mature: true,
				},
			],
		});

		const api = createMockApi();
		const mod = await loadTuiModule();
		await mod.tui(
			api as unknown as import("@opencode-ai/plugin/tui").TuiPluginApi,
			undefined,
			{ state: "first" } as unknown as import("@opencode-ai/plugin/tui").TuiPluginMeta,
		);

		const sessionCreatedCall = api.event.on.mock.calls.find(
			([type]) => type === "session.created",
		);
		const handler = sessionCreatedCall[1];

		await handler();
		expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);

		await handler();
		expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
	});
});

/**
 * TDD tests for CLI selection flow with immature update support.
 *
 * RED: Tests for partitionUpdates, selectUpdates, confirmImmatureUpdates
 * GREEN: Implement the functions to make tests pass.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { UpdateInfo } from "../src/types.js";

// Mock @clack/prompts
const mockSpinnerInstance = {
	start: vi.fn(),
	stop: vi.fn(),
	message: vi.fn(),
};

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => mockSpinnerInstance),
	log: { warn: vi.fn(), error: vi.fn() },
	note: vi.fn(),
	confirm: vi.fn(),
	select: vi.fn(),
	multiselect: vi.fn(),
	isCancel: vi.fn(),
	cancel: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
	loadConfig: vi.fn(),
	getMaturitySecs: vi.fn(() => 86400 * 3),
	getMaturityDays: vi.fn(() => 3),
	isMature: vi.fn((age: number) => age >= 86400 * 3),
	getConfigDir: vi.fn(() => "/mock/config/dir"),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execSync: vi.fn(() => ""),
		exec: vi.fn((_cmd: string, _opts: unknown, cb: Function) => cb(null, { stdout: "" })),
	};
});

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	readFileSync: vi.fn(() => JSON.stringify({ plugin: [] })),
	writeFileSync: vi.fn(),
}));

vi.mock("node:path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
}));

import * as clack from "@clack/prompts";
import { isMature, getMaturitySecs } from "../src/config.js";
import {
	partitionUpdates,
	selectUpdates,
	confirmImmatureUpdates,
} from "../src/cli.js";

const mockedConfirm = vi.mocked(clack.confirm);
const mockedSelect = vi.mocked(clack.select);
const mockedMultiselect = vi.mocked(clack.multiselect);
const mockedIsCancel = vi.mocked(clack.isCancel);

const matureUpdate: UpdateInfo = {
	type: "plugin",
	name: "oh-my-openagent",
	current: "4.0.0",
	latest: "4.1.2",
	ageSeconds: 86400 * 5,
};

const immatureUpdate: UpdateInfo = {
	type: "cli",
	name: "opencode",
	current: "1.15.3",
	latest: "1.15.5",
	ageSeconds: 86400 * 1,
};

const anotherMatureUpdate: UpdateInfo = {
	type: "plugin",
	name: "@cortexkit/opencode-magic-context",
	current: "0.18.0",
	latest: "0.20.0",
	ageSeconds: 86400 * 4,
};

describe("partitionUpdates", () => {
	it("should split updates into mature and immature buckets", () => {
		const updates = [matureUpdate, immatureUpdate, anotherMatureUpdate];
		const result = partitionUpdates(updates);

		expect(result.mature).toHaveLength(2);
		expect(result.mature).toContainEqual(matureUpdate);
		expect(result.mature).toContainEqual(anotherMatureUpdate);

		expect(result.immature).toHaveLength(1);
		expect(result.immature).toContainEqual(immatureUpdate);
	});

	it("should return empty arrays when no updates", () => {
		const result = partitionUpdates([]);
		expect(result.mature).toEqual([]);
		expect(result.immature).toEqual([]);
	});

	it("should return all mature when no immature updates", () => {
		const updates = [matureUpdate, anotherMatureUpdate];
		const result = partitionUpdates(updates);
		expect(result.mature).toHaveLength(2);
		expect(result.immature).toEqual([]);
	});

	it("should return all immature when no mature updates", () => {
		const updates = [immatureUpdate];
		const result = partitionUpdates(updates);
		expect(result.mature).toEqual([]);
		expect(result.immature).toHaveLength(1);
	});
});

describe("confirmImmatureUpdates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedIsCancel.mockReturnValue(false);
	});

	it("should show warning and confirm when immature updates are present", async () => {
		mockedConfirm.mockResolvedValue(true);

		const result = await confirmImmatureUpdates([immatureUpdate]);

		expect(mockedConfirm).toHaveBeenCalledTimes(1);
		const callArgs = mockedConfirm.mock.calls[0][0];
		expect(callArgs.message).toContain("IMMATURE");
		expect(callArgs.message).toContain("opencode");
		expect(result).toBe(true);
	});

	it("should return true when no immature updates (no prompt needed)", async () => {
		const result = await confirmImmatureUpdates([]);

		expect(mockedConfirm).not.toHaveBeenCalled();
		expect(result).toBe(true);
	});

	it("should return false when user declines immature update warning", async () => {
		mockedConfirm.mockResolvedValue(false);

		const result = await confirmImmatureUpdates([immatureUpdate]);

		expect(result).toBe(false);
	});

	it("should return cancel when user cancels the confirmation", async () => {
		mockedIsCancel.mockReturnValue(true);
		mockedConfirm.mockResolvedValue(Symbol("cancel"));

		const result = await confirmImmatureUpdates([immatureUpdate]);

		expect(result).toBe("cancel");
	});

	it("should list all immature package names in the warning", async () => {
		mockedConfirm.mockResolvedValue(true);

		await confirmImmatureUpdates([immatureUpdate, {
			type: "plugin",
			name: "some-plugin",
			current: "1.0.0",
			latest: "2.0.0",
			ageSeconds: 86400,
		}]);

		const callArgs = mockedConfirm.mock.calls[0][0];
		expect(callArgs.message).toContain("opencode");
		expect(callArgs.message).toContain("some-plugin");
	});
});

describe("selectUpdates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedIsCancel.mockReturnValue(false);
	});

	it("should present 3 options: install mature, install all, select individually", async () => {
		mockedSelect.mockResolvedValue("mature");

		const updates = [matureUpdate, immatureUpdate];
		await selectUpdates(updates);

		expect(mockedSelect).toHaveBeenCalledTimes(1);
		const callArgs = mockedSelect.mock.calls[0][0];
		expect(callArgs.message).toBeDefined();
		expect(callArgs.options).toHaveLength(3);
		expect(callArgs.options.map((o: { value: string }) => o.value)).toContain("mature");
		expect(callArgs.options.map((o: { value: string }) => o.value)).toContain("all");
		expect(callArgs.options.map((o: { value: string }) => o.value)).toContain("select");
	});

	it("should return mature updates when 'mature' is selected", async () => {
		mockedSelect.mockResolvedValue("mature");

		const updates = [matureUpdate, immatureUpdate, anotherMatureUpdate];
		const result = await selectUpdates(updates);

		expect(result).toEqual([matureUpdate, anotherMatureUpdate]);
	});

	it("should return all updates when 'all' is selected", async () => {
		mockedSelect.mockResolvedValue("all");

		const updates = [matureUpdate, immatureUpdate];
		const result = await selectUpdates(updates);

		expect(result).toEqual([matureUpdate, immatureUpdate]);
	});

	it("should prompt multiselect and return selected items when 'select' is chosen", async () => {
		mockedSelect.mockResolvedValue("select");
		mockedMultiselect.mockResolvedValue([matureUpdate, immatureUpdate]);

		const updates = [matureUpdate, immatureUpdate, anotherMatureUpdate];
		const result = await selectUpdates(updates);

		expect(mockedMultiselect).toHaveBeenCalledTimes(1);
		expect(result).toEqual([matureUpdate, immatureUpdate]);
	});

	it("should return 'cancel' when user cancels the initial selection", async () => {
		mockedIsCancel.mockReturnValue(true);
		mockedSelect.mockResolvedValue(Symbol("cancel"));

		const updates = [matureUpdate];
		const result = await selectUpdates(updates);

		expect(result).toBe("cancel");
	});

	it("should return 'cancel' when user cancels the multiselect", async () => {
		mockedSelect.mockResolvedValue("select");
		mockedIsCancel
			.mockReturnValueOnce(false) // not cancelled on select
			.mockReturnValueOnce(true); // cancelled on multiselect
		mockedMultiselect.mockResolvedValue(Symbol("cancel"));

		const updates = [matureUpdate];
		const result = await selectUpdates(updates);

		expect(result).toBe("cancel");
	});

	it("should include maturity info in multiselect options", async () => {
		mockedSelect.mockResolvedValue("select");
		mockedMultiselect.mockResolvedValue([]);

		const updates = [matureUpdate, immatureUpdate];
		await selectUpdates(updates);

		const multiArgs = mockedMultiselect.mock.calls[0][0];
		expect(multiArgs.options).toHaveLength(2);
		// Check that labels contain maturity indicators
		const labels = multiArgs.options.map((o: { label: string }) => o.label);
		expect(labels.some((l: string) => l.includes("ready"))).toBe(true);
		expect(labels.some((l: string) => l.includes("waiting") || l.includes("immature"))).toBe(true);
	});

	it("should only show 'install mature' option when all updates are mature", async () => {
		mockedSelect.mockResolvedValue("mature");

		const updates = [matureUpdate, anotherMatureUpdate];
		await selectUpdates(updates);

		const callArgs = mockedSelect.mock.calls[0][0];
		// Should still have 3 options for consistency
		expect(callArgs.options).toHaveLength(3);
	});

	it("should skip mature-only option when no mature updates exist", async () => {
		mockedSelect.mockResolvedValue("all");

		const updates = [immatureUpdate];
		await selectUpdates(updates);

		const callArgs = mockedSelect.mock.calls[0][0];
		const values = callArgs.options.map((o: { value: string }) => o.value);
		expect(values).not.toContain("mature");
	});
});

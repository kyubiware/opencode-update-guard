/**
 * TDD tests for CLI selection flow with immature update support.
 *
 * RED: Tests for partitionUpdates, selectUpdates, confirmImmatureUpdates
 * GREEN: Implement the functions to make tests pass.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { UpdateInfo, VersionInfo, DetailedUpdateInfo } from "../src/types.js";

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
	realpathSync: vi.fn((p: string) => p),
}));

vi.mock("node:path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
}));

import * as clack from "@clack/prompts";
import { isMature, getMaturitySecs } from "../src/config.js";
import {
	partitionUpdates,
	partitionVersions,
	selectUpdates,
	selectVersions,
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

// ── partitionVersions ──────────────────────────────────────────

const matureVer1: VersionInfo = { version: "1.0.0", ageSeconds: 86400 * 5 };
const matureVer2: VersionInfo = { version: "2.0.0", ageSeconds: 86400 * 5 };
const immatureVer3: VersionInfo = { version: "3.0.0", ageSeconds: 86400 * 1 };
const immatureVer1_5: VersionInfo = { version: "1.5.0", ageSeconds: 86400 * 1 };

describe("partitionVersions", () => {
	it("should split mixed input into newestMature and immature sorted desc", () => {
		const versions = [matureVer1, matureVer2, immatureVer3, immatureVer1_5];
		const result = partitionVersions(versions);

		expect(result.newestMature).toEqual(matureVer2);
		expect(result.immature).toHaveLength(2);
		expect(result.immature[0]).toEqual(immatureVer3);
		expect(result.immature[1]).toEqual(immatureVer1_5);
	});

	it("should return null newestMature when no mature versions exist", () => {
		const versions = [immatureVer3, immatureVer1_5];
		const result = partitionVersions(versions);

		expect(result.newestMature).toBeNull();
		expect(result.immature).toHaveLength(2);
	});

	it("should return empty immature when all versions are mature", () => {
		const versions = [matureVer1, matureVer2];
		const result = partitionVersions(versions);

		expect(result.newestMature).toEqual(matureVer2);
		expect(result.immature).toEqual([]);
	});

	it("should handle empty input", () => {
		const result = partitionVersions([]);

		expect(result.newestMature).toBeNull();
		expect(result.immature).toEqual([]);
	});

	it("should sort immature versions descending by semver", () => {
		const versions = [immatureVer1_5, immatureVer3];
		const result = partitionVersions(versions);

		expect(result.newestMature).toBeNull();
		expect(result.immature).toHaveLength(2);
		expect(result.immature[0]).toEqual(immatureVer3);
		expect(result.immature[1]).toEqual(immatureVer1_5);
	});
});

// ── selectVersions ─────────────────────────────────────────────

const detailedPkg1: DetailedUpdateInfo = {
	type: "plugin",
	name: "oh-my-openagent",
	current: "4.0.0",
	versions: [immatureVer3, matureVer2, matureVer1], // sorted desc by semver
};

const detailedPkg2: DetailedUpdateInfo = {
	type: "cli",
	name: "opencode",
	current: "1.15.3",
	versions: [immatureVer3, immatureVer1_5], // all immature, sorted desc
};

const detailedPkg3: DetailedUpdateInfo = {
	type: "plugin",
	name: "@cortexkit/opencode-magic-context",
	current: "0.18.0",
	versions: [matureVer2, matureVer1], // all mature, sorted desc
};

describe("selectVersions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedIsCancel.mockReturnValue(false);
	});

	it("should present 3 options when at least one package has a mature version", async () => {
		mockedSelect.mockResolvedValue("mature");

		await selectVersions([detailedPkg1, detailedPkg2]);

		expect(mockedSelect).toHaveBeenCalledTimes(1);
		const callArgs = mockedSelect.mock.calls[0][0];
		expect(callArgs.options).toHaveLength(3);
		const values = callArgs.options.map((o: { value: string }) => o.value);
		expect(values).toContain("mature");
		expect(values).toContain("all");
		expect(values).toContain("select");
	});

	it("should skip mature-only option when no package has a mature version", async () => {
		mockedSelect.mockResolvedValue("all");

		await selectVersions([detailedPkg2]);

		const callArgs = mockedSelect.mock.calls[0][0];
		const values = callArgs.options.map((o: { value: string }) => o.value);
		expect(values).not.toContain("mature");
		expect(values).toContain("all");
		expect(values).toContain("select");
	});

	it("'mature' returns newest mature version per package", async () => {
		mockedSelect.mockResolvedValue("mature");

		const result = await selectVersions([detailedPkg1, detailedPkg2, detailedPkg3]);

		expect(Array.isArray(result)).toBe(true);
		const arr = result as typeof result extends "cancel" ? never : typeof result;
		expect(arr).toHaveLength(2);
		expect(arr[0].name).toBe("oh-my-openagent");
		expect(arr[0].selectedVersion).toEqual(matureVer2);
		expect(arr[1].name).toBe("@cortexkit/opencode-magic-context");
		expect(arr[1].selectedVersion).toEqual(matureVer2);
	});

	it("'all' returns newest mature or latest version per package", async () => {
		mockedSelect.mockResolvedValue("all");

		const result = await selectVersions([detailedPkg1, detailedPkg2, detailedPkg3]);

		expect(Array.isArray(result)).toBe(true);
		const arr = result as typeof result extends "cancel" ? never : typeof result;
		expect(arr).toHaveLength(3);

		// pkg1 has mature versions → newestMature (2.0.0)
		const pkg1 = arr.find((r) => r.name === "oh-my-openagent");
		expect(pkg1?.selectedVersion).toEqual(matureVer2);

		// pkg2 has no mature → latest (versions[0] = 3.0.0)
		const pkg2 = arr.find((r) => r.name === "opencode");
		expect(pkg2?.selectedVersion).toEqual(immatureVer3);

		// pkg3 has mature → newestMature (2.0.0)
		const pkg3 = arr.find((r) => r.name === "@cortexkit/opencode-magic-context");
		expect(pkg3?.selectedVersion).toEqual(matureVer2);
	});

	it("two-step select returns one version per selected package", async () => {
		mockedSelect
			.mockResolvedValueOnce("select")
			.mockResolvedValueOnce(matureVer1);
		mockedMultiselect.mockResolvedValue(["oh-my-openagent"]);

		const result = await selectVersions([detailedPkg1, detailedPkg2]);

		expect(Array.isArray(result)).toBe(true);
		const arr = result as typeof result extends "cancel" ? never : typeof result;
		expect(arr).toHaveLength(1);
		expect(arr[0].name).toBe("oh-my-openagent");
		expect(arr[0].type).toBe("plugin");
		expect(arr[0].current).toBe("4.0.0");
		expect(arr[0].selectedVersion).toEqual(matureVer1);

		// Verify multiselect was called with package options
		expect(mockedMultiselect).toHaveBeenCalledTimes(1);
		const multiArgs = mockedMultiselect.mock.calls[0][0];
		expect(multiArgs.options).toHaveLength(2);
		expect(multiArgs.options[0].value).toBe("oh-my-openagent");
		expect(multiArgs.options[1].value).toBe("opencode");
	});

	it("version options show maturity indicator and age", async () => {
		mockedSelect
			.mockResolvedValueOnce("select")
			.mockResolvedValueOnce(matureVer1);
		mockedMultiselect.mockResolvedValue(["oh-my-openagent"]);

		await selectVersions([detailedPkg1]);

		// Second select call is for version selection
		const versionSelectArgs = mockedSelect.mock.calls[1][0];
		// Only newest mature + immature shown (intermediate mature filtered out)
		expect(versionSelectArgs.options).toHaveLength(2);

		// immatureVer3 (3.0.0, 1 day old) → immature, shows remaining
		const immatureOption = versionSelectArgs.options.find(
			(o: { value: VersionInfo }) => o.value === immatureVer3,
		);
		expect(immatureOption?.label).toContain("remaining");
		expect(immatureOption?.label).toContain("⏳ waiting");

		// matureVer2 (2.0.0, 5 days old) → newest mature, shows age
		const matureOption = versionSelectArgs.options.find(
			(o: { value: VersionInfo }) => o.value === matureVer2,
		);
		expect(matureOption?.label).toContain("old");
		expect(matureOption?.label).toContain("✓ ready");
	});

	it("empty package selection returns empty array", async () => {
		mockedSelect.mockResolvedValueOnce("select");
		mockedMultiselect.mockResolvedValue([]);

		const result = await selectVersions([detailedPkg1]);

		expect(result).toEqual([]);
	});

	it("should return 'cancel' when user cancels the initial selection", async () => {
		mockedIsCancel.mockReturnValue(true);
		mockedSelect.mockResolvedValue(Symbol("cancel"));

		const result = await selectVersions([detailedPkg1]);

		expect(result).toBe("cancel");
	});

	it("should return 'cancel' when user cancels package selection", async () => {
		mockedSelect.mockResolvedValueOnce("select");
		mockedIsCancel
			.mockReturnValueOnce(false) // not cancelled on top-level select
			.mockReturnValueOnce(true); // cancelled on multiselect
		mockedMultiselect.mockResolvedValue(Symbol("cancel"));

		const result = await selectVersions([detailedPkg1]);

		expect(result).toBe("cancel");
	});

	it("should return 'cancel' when user cancels version selection", async () => {
		mockedSelect
			.mockResolvedValueOnce("select")
			.mockResolvedValueOnce(Symbol("cancel"));
		mockedMultiselect.mockResolvedValue(["oh-my-openagent"]);
		mockedIsCancel
			.mockReturnValueOnce(false) // top-level select
			.mockReturnValueOnce(false) // multiselect
			.mockReturnValueOnce(true); // version select

		const result = await selectVersions([detailedPkg1]);

		expect(result).toBe("cancel");
	});

	it("does not show intermediate mature versions in individual select", async () => {
		// detailedPkg1 has versions: [immatureVer3 (3.0.0), matureVer2 (2.0.0), matureVer1 (1.0.0)]
		// Individual select should only show newest mature (matureVer2) + immature (immatureVer3)
		// It should NOT show matureVer1 (intermediate mature)
		mockedSelect
			.mockResolvedValueOnce("select")
			.mockResolvedValueOnce(matureVer2);
		mockedMultiselect.mockResolvedValue(["oh-my-openagent"]);

		await selectVersions([detailedPkg1]);

		// Second select call is for version selection
		const versionSelectArgs = mockedSelect.mock.calls[1][0];
		const optionValues = versionSelectArgs.options.map(
			(o: { value: VersionInfo }) => o.value,
		);

		// Should contain newest mature (matureVer2) and immature (immatureVer3)
		expect(optionValues).toContain(matureVer2);
		expect(optionValues).toContain(immatureVer3);

		// Should NOT contain intermediate mature (matureVer1)
		expect(optionValues).not.toContain(matureVer1);

		// Should have exactly 2 options
		expect(optionValues).toHaveLength(2);
	});
});

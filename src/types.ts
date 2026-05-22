export interface UpdateInfo {
	type: "cli" | "plugin";
	name: string;
	current: string;
	latest: string;
	ageSeconds: number;
}

export interface VersionInfo {
	version: string;
	ageSeconds: number;
}

export interface DetailedUpdateInfo {
	type: "cli" | "plugin";
	name: string;
	current: string;
	versions: VersionInfo[];
}

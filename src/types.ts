export interface UpdateInfo {
	type: "cli" | "pkg" | "plugin";
	name: string;
	current: string;
	latest: string;
	ageSeconds: number;
}

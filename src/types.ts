export interface UpdateInfo {
	type: "cli" | "plugin";
	name: string;
	current: string;
	latest: string;
	ageSeconds: number;
}

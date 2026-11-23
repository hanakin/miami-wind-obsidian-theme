// Shapes shared by the viewer server and page.
export interface Fixture {
	id: string;
	component: string;
	surface: string;
	state: string;
	note?: string;
	/** Fixture file size in bytes. */
	size: number;
}

export interface ComponentEntry {
	surfaces: string[];
	multiSurface: boolean;
	fixtures: string[];
}

/** One shared component from the build's component-usage.json. */
export interface Usage {
	component: string;
	usages: { surface: string; selector: string; properties: Record<string, string> }[];
}

/** workbench/out/component-diffs.json, written by the compare tool. */
export type Diffs = Record<string, Record<string, { same: boolean; props: string[] }>>;

export interface ViewerData {
	/** False until `bun run capture:extract-app-css` has run. */
	appCss: boolean;
	fixtures: Fixture[];
	components: Record<string, ComponentEntry>;
	usage: Usage[];
	/** Null until the compare tool has written its file. */
	diffs: Diffs | null;
	/** Ids of fixtures the compare tool found changed (from compare.json); null until it has run. */
	changed: string[] | null;
}

export type Theme = "current" | "new";

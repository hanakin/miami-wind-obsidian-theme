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

/** The compare tool's verdict on one fixture, current theme against new build. */
export type CompareState =
	| { kind: "same" | "changed" | "hidden" }
	| { kind: "unsupported"; what: string[] };

export interface ViewerData {
	/** False until `bun run capture:extract-app-css` has run. */
	appCss: boolean;
	/** False until the compare tool has extracted Obsidian's CodeMirror runtime rules. */
	cmCss: boolean;
	fixtures: Fixture[];
	components: Record<string, ComponentEntry>;
	usage: Usage[];
	/** Null until the compare tool has written its file. */
	diffs: Diffs | null;
	/** Per-fixture verdicts by id; null until the compare tool has run. */
	compare: Record<string, CompareState> | null;
	/** Why compare.json could not be used, when it exists but is not a schemaVersion 1 report. */
	compareError?: string;
}

export type Theme = "current" | "new";

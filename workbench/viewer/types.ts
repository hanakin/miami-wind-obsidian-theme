import type { Change } from "./compare-states.ts";
// Shapes shared by the viewer server and page.
export interface Fixture {
	id: string;
	component: string;
	surface: string;
	state: string;
	note?: string;
	/** Fixture file size in bytes. */
	size: number;
	/** The window size it was captured at, when not the desktop default (emulated mobile). */
	viewport?: [number, number];
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
	| { status: "same" }
	| { status: "different" }
	| { status: "not-proven"; reasons: string[] }
	/** A documented, intentional change: its own state, never "same". */
	| { status: "accepted"; reason: string };

export interface ViewerData {
	/** False until `bun run capture:extract-app-css` has run. */
	appCss: boolean;
	/** False until `bun run capture:extract-runtime-css` has run. */
	cmCss: boolean;
	fixtures: Fixture[];
	components: Record<string, ComponentEntry>;
	usage: Usage[];
	/** Null until the compare tool has written its file. */
	diffs: Diffs | null;
	/** Per-fixture verdicts by id; null until the compare tool has run. */
	compare: Record<string, CompareState> | null;
	/** What the compare report says about itself; null until the compare tool has run. */
	report: ReportInfo | null;
	/** What differs in each capture that is not the same, by fixture id. */
	changes: Record<string, { total: number; list: Change[]; diffImage: boolean }>;
	/** Per capture with differences: the components that have one on their own elements. */
	touched: Record<string, string[]>;
	/** Why compare.json could not be used, when it exists but is not a schemaVersion 1 report. */
	compareError?: string;
}

/** Which build a compare report describes, and whether the pictures here show that same build. */
export interface ReportInfo {
	/** When the report was written (ISO). From the report, or failing that its file date. */
	generated: string;
	/** The 2.0 theme the report compared, when it records one. */
	after?: { sha256: string; source?: string };
	/** True when the report's 2.0 theme is not the current theme.css; null when it does not say. */
	stale: boolean | null;
	/** True when the pictures are drawn with the very theme files the report compared. */
	exact: boolean;
}

export type Theme = "current" | "new";

import type { Organization } from "./organization.ts";
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
	/** Where the captured element sat in the live window: x, y, width, height. */
	box?: [number, number, number, number];
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
	| { status: "not-proven"; reasons: string[] };

export interface ViewerData {
	/** False until `bun run capture:extract-app-css` has run. */
	appCss: boolean;
	/** False until `bun run capture:extract-runtime-css` has run. */
	cmCss: boolean;
	fixtures: Fixture[];
	components: Record<string, ComponentEntry>;
	usage: Usage[];
	/** Why compare.json could not be used, when it exists but is not a schemaVersion 1 report. */
	compareError?: string;
	/** Where fixture frames are served: an address of their own, apart from the workbench's. */
	frameOrigin: string;
	/** The sidebar: items grouped by the source file that styles them, and the overlaps found. */
	organization: Organization;
	/** The items each shared build component is used on, found from the rules that include it. */
	componentItems: Record<string, string[]>;
}

/** One side as the page knows it: a name and the hash of its CSS, or why it cannot be shown. */
export type ResolvedSide = { label: string; sha256: string } | { error: string };

export type Which = "left" | "right";

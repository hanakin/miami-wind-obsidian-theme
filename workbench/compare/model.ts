export interface ElementStyle {
	element: string;
	props: Record<string, string>;
}
export function comparisonExitCode(results: readonly { status: string }[]) {
	if (results.some((result) => result.status === "different")) return 1;
	return results.some((result) => result.status === "not-proven") ? 2 : 0;
}
export interface Difference {
	element: string;
	property: string;
	before: string | null;
	after: string | null;
}
export function styleDiff(
	before: ElementStyle[],
	after: ElementStyle[],
): Difference[] {
	const result: Difference[] = [];
	const a = new Map(before.map((e) => [e.element, e.props]));
	const b = new Map(after.map((e) => [e.element, e.props]));
	const empty: Record<string, string> = {};
	// Browser snapshots intern equal style vectors. Compare each pair once, but
	// retain a separate difference for every element that uses that pair.
	const pairs = new Map<
		Record<string, string>,
		Map<Record<string, string>, Omit<Difference, "element">[]>
	>();
	for (const element of new Set([...a.keys(), ...b.keys()])) {
		const x = a.get(element) ?? empty,
			y = b.get(element) ?? empty;
		let matches = pairs.get(x);
		if (!matches) {
			matches = new Map();
			pairs.set(x, matches);
		}
		let changes = matches.get(y);
		if (!changes) {
			changes = [];
			for (const property of new Set([...Object.keys(x), ...Object.keys(y)]))
				if (x[property] !== y[property])
					changes.push({
						property,
						before: x[property] ?? null,
						after: y[property] ?? null,
					});
			matches.set(y, changes);
		}
		for (const change of changes) result.push({ element, ...change });
	}
	return result;
}
export interface Sample {
	component: string;
	surface: string;
	state: string;
	props: Record<string, string>;
}
export function componentDiffs(
	samples: Sample[],
): Record<string, Record<string, { same: boolean; props: string[] }>> {
	const result: ReturnType<typeof componentDiffs> = {};
	for (const component of new Set(samples.map((s) => s.component))) {
		const uses = samples.filter((s) => s.component === component);
		if (new Set(uses.map((s) => s.surface)).size < 2) continue;
		const exceptions = new Map<string, Set<string>>();
		for (const s of uses) exceptions.set(s.surface, new Set());
		// Shared look is the per-property mode across uses of the same state, avoiding hover/rest comparisons.
		// Ties use the first fixture in ID order. Container dimensions do not define a shared component look.
		for (const state of new Set(uses.map((s) => s.state))) {
			const group = uses.filter((s) => s.state === state);
			for (const prop of new Set(group.flatMap((s) => Object.keys(s.props)))) {
				if (
					[
						"width",
						"height",
						"inline-size",
						"block-size",
						"transform-origin",
						"perspective-origin",
					].includes(prop)
				)
					continue;
				const counts = new Map<string, number>();
				for (const s of group) {
					const v = s.props[prop] ?? "";
					counts.set(v, (counts.get(v) ?? 0) + 1);
				}
				const shared = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
				for (const s of group)
					if ((s.props[prop] ?? "") !== shared)
						exceptions.get(s.surface)?.add(prop);
			}
		}
		result[component] = Object.fromEntries(
			[...exceptions].map(([surface, props]) => [
				surface,
				{ same: props.size === 0, props: [...props].sort() },
			]),
		);
	}
	return result;
}
export function filterFixtures<
	T extends {
		id: string;
		component: string;
		contains: string[];
		surface: string;
	},
>(
	fixtures: T[],
	filters: {
		id?: string | readonly string[];
		component?: string;
		surface?: string;
	},
): T[] {
	return fixtures.filter(
		(f) =>
			(!filters.id ||
				(typeof filters.id === "string"
					? f.id.includes(filters.id)
					: filters.id.includes(f.id))) &&
			(!filters.surface || f.surface === filters.surface) &&
			(!filters.component ||
				f.component === filters.component ||
				f.contains.includes(filters.component)),
	);
}

export function mergedCoverage(
	...sides: {
		invisibleTarget: boolean;
		unsupported: string[];
		replayIssues: string[];
	}[]
) {
	return {
		invisible: sides.some((s) => s.invisibleTarget),
		unsupported: [...new Set(sides.flatMap((s) => s.unsupported))],
		replayIssues: [...new Set(sides.flatMap((s) => s.replayIssues))],
	};
}
export function outcome(input: {
	differences: number;
	pixels: number;
	noise: boolean;
	invisible: boolean;
	unsupported: string[];
	replayIssues: string[];
}) {
	const reasons = [...input.replayIssues];
	if (input.noise) reasons.push("same-CSS repeat noise");
	if (input.invisible) reasons.push("target has no visible box");
	for (const kind of new Set(input.unsupported))
		if (
			[
				"canvas",
				"video",
				"audio",
				"iframe",
				"embed",
				"object",
				"img",
				"webview",
				"background image",
			].includes(kind)
		)
			reasons.push(`${kind} content is not reconstructed`);
	const status = input.differences
		? "different"
		: input.noise
			? "not-proven"
			: input.pixels
				? "different"
				: reasons.length
					? "not-proven"
					: "same";
	return { status, same: status === "same", notProvenReasons: reasons };
}

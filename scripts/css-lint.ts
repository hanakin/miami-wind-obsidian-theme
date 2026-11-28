import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import stylelint from "stylelint";
import permanent from "../config/stylelint-obsidian.json";
import { stylelintConfig } from "./stylelint-config";

export interface Finding {
	file: string;
	rule: string;
	selector: string;
	property: string;
	value: string;
	text: string;
}
export interface CssException {
	file: string;
	rule: string;
	selector: string;
	count: number;
	reason: string;
}
interface ExceptionGroup {
	file: string;
	rule: string;
	reason: string;
	selectors: { selector: string; count: number }[];
}
const expand = (groups: ExceptionGroup[]): CssException[] =>
	groups.flatMap((group) =>
		group.selectors.map((item) => ({
			file: group.file,
			rule: group.rule,
			reason: group.reason,
			...item,
		})),
	);
const identity = (finding: Pick<Finding, "file" | "rule" | "selector">) =>
	JSON.stringify([finding.file, finding.rule, finding.selector]);

export function partitionFindings(
	findings: Finding[],
	exceptions: CssException[],
) {
	const used = new Map<string, number>();
	const excepted: Finding[] = [],
		unexpected: Finding[] = [];
	for (const finding of findings) {
		const key = identity(finding);
		const exception = exceptions.find((item) => identity(item) === key);
		const count = (used.get(key) ?? 0) + 1;
		used.set(key, count);
		(exception && count <= exception.count ? excepted : unexpected).push(
			finding,
		);
	}
	const stale = exceptions.filter(
		(exception) => (used.get(identity(exception)) ?? 0) < exception.count,
	);
	return { excepted, unexpected, stale };
}

function context(
	root: postcss.Root,
	line: number,
	column: number,
): Pick<Finding, "selector" | "property" | "value"> {
	const offset =
		root.source?.input.css
			.split("\n")
			.slice(0, line - 1)
			.reduce((sum, text) => sum + text.length + 1, 0) ?? 0;
	const position = offset + column - 1;
	const found = { selector: "@root", property: "", value: "" };
	root.walk((node) => {
		if (
			!node.source?.start ||
			!node.source.end ||
			node.source.start.offset > position ||
			node.source.end.offset < position
		)
			return;
		if (node.type === "rule")
			found.selector = node.selectors.map((item) => item.trim()).join(", ");
		if (node.type === "atrule" && found.selector === "@root")
			found.selector = `@${node.name} ${node.params}`;
		if (node.type === "decl") {
			found.property = node.prop;
			found.value = node.value;
		}
	});
	return found;
}

async function inspectCss() {
	const files = [
		"theme.css",
		...Array.from(new Bun.Glob("src/**/*.css").scanSync(".")).sort(),
	];
	const result = await stylelint.lint({ files, config: stylelintConfig });
	const findings: Finding[] = [];
	for (const file of result.results) {
		if (!file.source) throw new Error("Stylelint returned an unnamed source");
		const relative = path.relative(process.cwd(), file.source);
		const root = postcss.parse(await readFile(file.source, "utf8"), {
			from: file.source,
		});
		for (const warning of file.warnings)
			findings.push({
				file: relative,
				rule: warning.rule,
				...context(root, warning.line, warning.column),
				text: warning.text.replace(
					/first used at line \d+/g,
					"first used earlier",
				),
			});
	}
	return { findings };
}

export async function lintCss() {
	const { findings } = await inspectCss();
	const permanentResult = partitionFindings(
		findings,
		expand(permanent as ExceptionGroup[]),
	);
	const temporaryResult = partitionFindings(permanentResult.unexpected, []);
	const counts: Record<string, number> = {};
	for (const finding of findings)
		counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
	return {
		counts,
		findings,
		stale: [...permanentResult.stale, ...temporaryResult.stale],
		permanent: permanentResult.excepted.length,
		temporary: temporaryResult.excepted.length,
		unexpected: temporaryResult.unexpected,
	};
}

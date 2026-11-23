import { expect, it } from "vitest";
import { forceStateSelector, forceStates } from "./force-states.ts";

const hover = '[data-capture-state~="hover"]';

it("makes interactive pseudo-classes match the captured state mark", () => {
	expect(forceStateSelector(".a:hover .b")).toBe(`.a:is(:hover, ${hover}, :has(${hover})) .b`);
	expect(forceStateSelector("input:focus-visible")).toBe(
		'input:is(:focus-visible, [data-capture-state~="focus-visible"])',
	);
	expect(forceStateSelector(".a:not(:hover)::before")).toBe(
		`.a:not(:is(:hover, ${hover}, :has(${hover})))::before`,
	);
});

it("leaves pseudo-element states and plain selectors alone", () => {
	expect(forceStateSelector("::-webkit-scrollbar-thumb:hover")).toBe(
		"::-webkit-scrollbar-thumb:hover",
	);
	expect(forceStateSelector(".a::before, .b")).toBe(".a::before, .b");
});

it("rewrites whole stylesheets, nested at-rules included", () => {
	expect(forceStates("@media (hover: hover) { a:visited { color: red } }")).toBe(
		'@media (hover: hover) { a:is(:visited, [data-capture-state~="visited"]) { color: red } }',
	);
});

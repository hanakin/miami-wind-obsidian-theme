// bun run check:organization — every item must be styled from one place in src/. Lists each item
// styled from more than one (with the files) and fails while any remain. The fix is in the
// source: move the rules into global/.
import { RULES } from "./organization.ts";
import { organization } from "./source.ts";

const { overlaps } = await organization();
const rules = `How this is judged:\n${RULES.map((r) => `  - ${r}`).join("\n")}`;
if (overlaps.length === 0) {
	console.log(`Organization: every item is styled from one place.\n${rules}`);
} else {
	console.log(
		`Organization: ${overlaps.length} items are styled from more than one place.\n${rules}\n`,
	);
	console.log("Move their rules into src/global/ so each has one home:");
	for (const { item, rules } of overlaps) {
		console.log(`- ${item}`);
		for (const rule of rules) console.log(`    ${rule}`);
	}
	process.exit(1);
}

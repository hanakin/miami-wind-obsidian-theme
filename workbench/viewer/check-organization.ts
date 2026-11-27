// bun run check:organization — every item must be styled from one place in src/. Lists each item
// styled from more than one (with the files) and fails while any remain. The fix is in the
// source: move the rules into global/.
import { organization } from "./source.ts";

const { overlaps } = await organization();
if (overlaps.length === 0) {
	console.log("Organization: every item is styled from one place.");
} else {
	console.log(`Organization: ${overlaps.length} items are styled from more than one place.`);
	console.log("Move their rules into src/global/ so each has one home.\n");
	for (const { item, files } of overlaps)
		console.log(`- ${item}: ${files.map((f) => `src/${f}`).join(", ")}`);
	process.exit(1);
}

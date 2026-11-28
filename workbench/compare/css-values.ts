import { createRequire } from "node:module";

interface Tokens {
	endOfFile(): boolean;
	nextToken(): readonly [string, string, ...unknown[]] | undefined;
}
// PostCSS exports this tokenizer; use the existing dependency without rewriting its
// handling of comments, escaped identifiers and quoted/unquoted URL arguments.
const tokenize = createRequire(import.meta.url)(
	"postcss/lib/tokenize",
) as (input: {
	css: string;
	error(message: string, offset: number): Error;
}) => Tokens;
const keys = new Map<string, string>();
const whitespace = /[ \t\n\r\f]/;
function character(point: number): string {
	return String.fromCodePoint(
		!point || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
			? 0xfffd
			: point,
	);
}
/** CSS Syntax string/escape algorithms: https://www.w3.org/TR/css-syntax-3/#consume-string-token */
function stringValue(raw: string): string | undefined {
	const end = raw.length - 1;
	if (raw[end] !== raw[0]) return undefined;
	let result = "";
	for (let i = 1; i < end; ) {
		if (raw[i] === "\\") {
			i++;
			if (i >= end) return undefined;
			const hex = raw.slice(i).match(/^[\da-f]{1,6}/i)?.[0];
			if (hex) {
				result += character(Number.parseInt(hex, 16));
				i += hex.length;
				if (whitespace.test(raw[i] ?? "")) {
					if (raw[i] === "\r" && raw[i + 1] === "\n") i++;
					i++;
				}
				continue;
			}
			if (/[\n\r\f]/.test(raw[i] ?? "")) {
				if (raw[i] === "\r" && raw[i + 1] === "\n") i++;
				i++;
				continue;
			}
		} else if (/[\n\r\f]/.test(raw[i] ?? "")) return undefined;
		const point = raw.codePointAt(i);
		if (point === undefined) return undefined;
		result += character(point);
		i += point > 0xffff ? 2 : 1;
	}
	return result;
}

/** Only string tokens change representation. Every other token retains its exact text. */
export function propertyValueKey(property: string, value: string): string {
	if (!property.startsWith("--")) return value;
	const known = keys.get(value);
	if (known !== undefined) return known;
	const parts: string[][] = [];
	try {
		// A minimal source object avoids Input's BOM stripping: non-string text must remain exact.
		const stream = tokenize({
			css: value,
			error: (message) => new Error(message),
		});
		while (!stream.endOfFile()) {
			const token = stream.nextToken();
			if (!token) break;
			const decoded = token[0] === "string" ? stringValue(token[1]) : undefined;
			parts.push(
				decoded === undefined
					? [token[0], token[1]]
					: ["string-value", decoded],
			);
		}
	} catch {
		// Malformed text never gains an equivalence through error recovery.
		parts.splice(0, parts.length, ["raw", value]);
	}
	const key = JSON.stringify(parts);
	keys.set(value, key);
	return key;
}

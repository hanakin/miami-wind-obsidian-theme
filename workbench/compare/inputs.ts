import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** Immutable bytes shared across workers; hashes describe consumed bytes, never later disk contents. */
export class Inputs {
	readonly hashes: Record<string, string>;
	private readonly cache: Map<string, Buffer>;
	private readonly all: Record<string, string>;
	constructor(parent?: Inputs, inherited: Record<string, string> = {}) {
		this.hashes = { ...inherited };
		this.cache = parent?.cache ?? new Map();
		this.all = parent?.all ?? this.hashes;
	}
	fork(inherited = this.hashes): Inputs {
		return new Inputs(this, inherited);
	}
	read(file: string): Buffer {
		const path = resolve(file);
		let bytes = this.cache.get(path);
		if (!bytes) {
			bytes = readFileSync(path);
			this.cache.set(path, bytes);
		}
		const local = relative(process.cwd(), path);
		const key = local.startsWith("..") || isAbsolute(local) ? path : local;
		const hash =
			this.all[key] ?? createHash("sha256").update(bytes).digest("hex");
		this.all[key] = hash;
		this.hashes[key] = hash;
		return bytes;
	}
}

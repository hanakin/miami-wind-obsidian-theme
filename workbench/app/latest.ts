// Keeps only the newest of several overlapping requests. Changing sides twice quickly starts two
// lookups; whichever answers last must not win unless it is also the one asked for last.

/**
 * Returns a runner. Each call runs `work` and gives back `{ value }`, or null when a newer call
 * started in the meantime: that answer is out of date and must not be shown.
 */
export function latest(): <T>(work: () => Promise<T>) => Promise<{ value: T } | null> {
	let turn = 0;
	return async (work) => {
		const mine = ++turn;
		const value = await work();
		return mine === turn ? { value } : null;
	};
}

/**
 * PostgREST (Supabase REST) responses are often capped per request (commonly 1000 rows).
 * Use stable order + range() in a loop until a short page is returned.
 */
export const SUPABASE_REST_PAGE_SIZE = 1000;

/**
 * @template T
 * @param {(from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>} runRange
 * @returns {Promise<T[]>}
 */
export async function fetchAllRowsPaged(runRange) {
	const out = [];
	let from = 0;
	for (;;) {
		const to = from + SUPABASE_REST_PAGE_SIZE - 1;
		const { data, error } = await runRange(from, to);
		if (error) throw error;
		const chunk = Array.isArray(data) ? data : [];
		out.push(...chunk);
		if (chunk.length < SUPABASE_REST_PAGE_SIZE) break;
		from += SUPABASE_REST_PAGE_SIZE;
	}
	return out;
}

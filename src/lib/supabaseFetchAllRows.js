/**
 * PostgREST (Supabase REST) applies a per-response row cap (project "max rows", often 1000).
 * A plain .select() can return an incomplete set with no error. This helper pages with .range()
 * until all rows are loaded. Pass a factory that returns a fresh query chain each call.
 *
 * @param {() => object} buildQuery - returns a Supabase query builder (PostgrestFilterBuilder)
 * @param {{ pageSize?: number }} [options]
 * @returns {Promise<any[]>}
 */
export async function fetchAllSupabaseRows(buildQuery, { pageSize = 1000 } = {}) {
	const all = [];
	let from = 0;
	for (;;) {
		const { data, error } = await buildQuery().range(from, from + pageSize - 1);
		if (error) throw error;
		const batch = data ?? [];
		if (batch.length === 0) break;
		all.push(...batch);
		if (batch.length < pageSize) break;
		from += pageSize;
	}
	return all;
}

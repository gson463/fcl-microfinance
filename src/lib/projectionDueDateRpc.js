import { format, parseISO, addDays } from 'date-fns';

/**
 * Resolves DB `next_working_day_after_exclusive()` to a readable label (date-fns `PPP`).
 * Matches behaviour in DashboardMetricDrilldown.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ label: string }>}
 */
export async function fetchProjectionDueLabelPretty(supabase) {
	const { data, error } = await supabase.rpc('next_working_day_after_exclusive');
	if (error || data == null) {
		const d = addDays(new Date(), 1);
		return { label: format(d, 'PPP') };
	}
	const raw = typeof data === 'string' ? data : String(data);
	const d = parseISO(raw.length <= 10 ? `${raw.trim().slice(0, 10)}T12:00:00` : raw);
	if (Number.isNaN(d.getTime())) {
		const fallback = addDays(new Date(), 1);
		return { label: format(fallback, 'PPP') };
	}
	return { label: format(d, 'PPP') };
}

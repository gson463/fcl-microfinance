import { format, parseISO } from 'date-fns';

/**
 * First working day strictly after refDate (yyyy-MM-dd), via DB (Mon–Sat, skip holidays).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} refDate yyyy-MM-dd business date (EAT)
 * @returns {Promise<{ dateStr: string, label: string }>}
 */
export async function fetchNextWorkingDayAfter(supabase, refDate) {
	const { data, error } = await supabase.rpc('next_working_day_after_exclusive', {
		p_ref: refDate,
	});
	if (error || data == null) {
		const fallback = refDate;
		return { dateStr: fallback, label: fallback };
	}
	const dateStr = typeof data === 'string' ? data.trim().slice(0, 10) : String(data).slice(0, 10);
	try {
		const d = parseISO(`${dateStr}T12:00:00`);
		return { dateStr, label: format(d, 'PPP') };
	} catch {
		return { dateStr, label: dateStr };
	}
}

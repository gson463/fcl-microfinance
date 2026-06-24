import { format, parseISO } from 'date-fns';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUuid(value) {
	if (!value || value === 'all') return null;
	const s = String(value).trim();
	return UUID_RE.test(s) ? s : null;
}

function normalizeStatus(value) {
	if (!value || value === 'all') return null;
	return String(value).trim() || null;
}

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

function formatBucketLabel(dateStr, granularity) {
	try {
		const d = parseISO(`${dateStr.slice(0, 10)}T12:00:00`);
		return granularity === 'month' ? format(d, 'MMM yyyy') : format(d, 'MMM dd');
	} catch {
		return dateStr;
	}
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   startDate: string,
 *   endDate: string,
 *   branchId?: string | null,
 *   officerId?: string | null,
 *   productId?: string | null,
 *   centerId?: string | null,
 *   groupId?: string | null,
 *   status?: string | null,
 *   granularity?: 'day' | 'month',
 * }} params
 */
export async function fetchReportsMetrics(supabase, params) {
	const granularity = params.granularity === 'month' ? 'month' : 'day';
	const { data, error } = await supabase.rpc('get_reports_metrics', {
		p_start_date: params.startDate,
		p_end_date: params.endDate,
		p_branch_id: normalizeUuid(params.branchId),
		p_officer_id: normalizeUuid(params.officerId),
		p_product_id: normalizeUuid(params.productId),
		p_center_id: normalizeUuid(params.centerId),
		p_group_id: normalizeUuid(params.groupId),
		p_status: normalizeStatus(params.status),
		p_granularity: granularity,
	});
	if (error) throw error;

	const raw = data && typeof data === 'object' ? data : {};
	const summary = raw.summary || {};

	return {
		summary: {
			totalPortfolio: num(summary.total_portfolio),
			principalDisbursed: num(summary.principal_disbursed),
			repaymentsCollected: num(summary.repayments_collected),
			prepaymentsCollected: num(summary.prepayments_collected),
			activeLoans: num(summary.active_loans),
			totalBorrowers: num(summary.total_borrowers),
			par: num(summary.par_pct),
		},
		barChartData: (raw.time_series || []).map((row) => ({
			name: formatBucketLabel(String(row.bucket_date || ''), granularity),
			Disbursed: num(row.disbursed),
			Scheduled: num(row.scheduled),
			Prepayment: num(row.prepayment),
		})),
		statusDistribution: (raw.status_distribution || []).map((row) => {
			const status = String(row.status || 'unknown');
			return {
				name: status.charAt(0).toUpperCase() + status.slice(1),
				value: num(row.count),
			};
		}),
		productPortfolio: (raw.product_portfolio || []).map((row) => ({
			name: row.product_name || 'Product',
			Portfolio: num(row.portfolio),
		})),
		branchPerformanceData: (raw.branch_performance || []).map((row) => ({
			branch: row.branch || '—',
			portfolio: num(row.portfolio),
			par: num(row.par),
			officers: num(row.officers),
		})),
		officerPerformanceData: (raw.officer_performance || []).map((row) => ({
			officer: row.officer || '—',
			portfolio: num(row.portfolio),
			par: num(row.par),
			loans: num(row.loans),
		})),
	};
}

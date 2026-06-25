import { buildOfficerCenterBlocks } from '@/lib/fieldWalletAggregates';
import { fetchAllRowsPaged } from '@/lib/supabaseFetchPaged';

const LOAN_SELECT = `id, loan_id, principal, disbursement_date, officer_id, borrower_id,
  borrowers(
    id, first_name, surname,
    groups(id, name, center_id, centers(id, name))
  )`;

/** No `loans` embed: totals only need loan_id + wallet fields; embedding can bloat or complicate PostgREST joins. Center splits use the separate loans query (borrower → group → center). */
const REP_SELECT =
	'id, amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, actual_payment_date, officer_id, loan_id';

/**
 * Field wallet for one calendar day (same formula as officer Field wallet / Excel DEPOSIT).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} dateStr yyyy-MM-dd
 * @param {Array<{ id: string, full_name?: string }>} officersInScope
 */
export async function fetchAdminFieldWalletSnapshot(supabase, dateStr, officersInScope) {
	const ids = (officersInScope || []).map((o) => o.id).filter(Boolean);
	if (ids.length === 0) {
		return {
			totalNetDeposit: 0,
			withdrawnOfficerCount: 0,
			officerCount: 0,
			blocks: [],
			withdrawByOfficer: new Map(),
			repaymentTotalsByOfficer: new Map(),
			applicationFee: 0,
			currency: 'TZS',
		};
	}

	const { data: cfg } = await supabase
		.from('system_config')
		.select('key, value')
		.in('key', ['applicationFeePerDisbursement', 'currency']);
	const map = Object.fromEntries((cfg || []).map((r) => [r.key, r.value]));
	const fee = parseFloat(map.applicationFeePerDisbursement) || 0;
	const currency = map.currency || 'TZS';

	const day = dateStr;
	const [repaymentRows, loanRows, expenseRows, takenRows, withdrawRowsRaw] = await Promise.all([
		fetchAllRowsPaged((from, to) =>
			supabase
				.from('repayments')
				.select(REP_SELECT)
				.eq('actual_payment_date', day)
				.in('officer_id', ids)
				.order('id', { ascending: true })
				.range(from, to),
		),
		fetchAllRowsPaged((from, to) =>
			supabase
				.from('loans')
				.select(LOAN_SELECT)
				.eq('disbursement_date', day)
				.in('officer_id', ids)
				.order('id', { ascending: true })
				.range(from, to),
		),
		fetchAllRowsPaged((from, to) =>
			supabase
				.from('expenses')
				.select('id, amount, expense_type, expense_date, officer_id')
				.eq('expense_date', day)
				.in('officer_id', ids)
				.order('id', { ascending: true })
				.range(from, to),
		),
		fetchAllRowsPaged((from, to) =>
			supabase
				.from('officer_field_taken')
				.select('officer_id, business_date, amount_taken')
				.eq('business_date', day)
				.in('officer_id', ids)
				.order('id', { ascending: true })
				.range(from, to),
		),
		fetchAllRowsPaged((from, to) =>
			supabase
				.from('officer_withdraw_to_bank')
				.select('officer_id, business_date, created_at, amount_deposited, closing_deposit, carried_to_next_day, planned_next_day_taken, top_up_from_office, next_business_date')
				.eq('business_date', day)
				.in('officer_id', ids)
				.order('id', { ascending: true })
				.range(from, to),
		),
	]);

	const { data: centersData } = await supabase
		.from('centers')
		.select('id, name, loan_officer_id')
		.in('loan_officer_id', ids)
		.order('name');

	const officerRows = officersInScope.map((o) => ({ id: o.id, full_name: o.full_name || 'Officer' }));
	const { blocks } = buildOfficerCenterBlocks({
		officers: officerRows,
		centers: centersData || [],
		repayments: repaymentRows,
		loans: loanRows,
		expenses: expenseRows,
		applicationFeePerDisbursement: fee,
		fieldTakenRows: takenRows,
	});

	const withdrawByOfficer = new Map();
	for (const w of withdrawRowsRaw) {
		withdrawByOfficer.set(w.officer_id, w);
	}

	// Align with officer_wallet_balance_for_period: after withdraw, in-hand = carried_to_next_day (0 if full bank).
	for (const b of blocks) {
		const raw = Number(b.totals.deposit) || 0;
		b.totals.rawDeposit = raw;
		const w = withdrawByOfficer.get(b.officer.id);
		if (w) {
			const carried = Number(w.carried_to_next_day) || 0;
			b.totals.deposit = carried > 0 ? carried : 0;
		}
	}

	const totalNetDeposit = blocks.reduce((s, b) => s + (Number(b.totals.deposit) || 0), 0);
	let withdrawnOfficerCount = 0;
	for (const b of blocks) {
		if (withdrawByOfficer.has(b.officer.id)) withdrawnOfficerCount += 1;
	}

	const repaymentTotalsByOfficer = new Map();
	for (const r of repaymentRows) {
		const oid = r.officer_id;
		if (!oid) continue;
		repaymentTotalsByOfficer.set(oid, (repaymentTotalsByOfficer.get(oid) || 0) + (Number(r.amount) || 0));
	}

	return {
		totalNetDeposit,
		withdrawnOfficerCount,
		officerCount: blocks.length,
		blocks,
		withdrawByOfficer,
		repaymentTotalsByOfficer,
		applicationFee: fee,
		currency,
	};
}

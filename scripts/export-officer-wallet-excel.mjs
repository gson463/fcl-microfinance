/**
 * Export officer wallet Excel to Desktop:
 * - 3 daily repayment sheets (last 3 EAT days)
 * - All repayments (all-time)
 * - Wallet history (taken, withdraw, expenses, disbursements)
 *
 * Requires in .env:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/export-officer-wallet-excel.mjs mrfadhilimlanzi@gmail.com
 *   npm run export:officer-wallet -- mrfadhilimlanzi@gmail.com
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { fetchAllRowsPaged } from '../src/lib/supabaseFetchPaged.js';
import {
	buildOfficerWalletWorkbook,
	buildWalletHistoryRows,
	sortRepaymentsNewestFirst,
	writeWorkbookToPath,
} from '../src/lib/officerWalletActivityExcel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EAT = 'Africa/Nairobi';

const REP_SELECT = `id, amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, actual_payment_date, payment_date, officer_id, loan_id, created_at,
  loans(
    loan_id,
    borrower_id,
    borrowers(
      id, first_name, surname,
      groups(id, name, center_id, centers(id, name))
    )
  )`;

const LOAN_SELECT = `id, loan_id, principal, disbursement_date, officer_id, borrower_id,
  borrowers(id, first_name, surname)`;

function loadDotenv() {
	const envPath = join(__dirname, '..', '.env');
	if (!existsSync(envPath)) return;
	const raw = readFileSync(envPath, 'utf8');
	for (const line of raw.split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		if (eq === -1) continue;
		const key = t.slice(0, eq).trim();
		let val = t.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

function todayEAT() {
	return formatInTimeZone(new Date(), EAT, 'yyyy-MM-dd');
}

function lastThreeEatDates() {
	const todayStr = todayEAT();
	const [y, m, d] = todayStr.split('-').map(Number);
	const base = new Date(y, m - 1, d);
	return [0, 1, 2].map((n) => formatInTimeZone(subDays(base, n), EAT, 'yyyy-MM-dd'));
}

function safeFileSlug(name) {
	return String(name ?? 'Officer')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '_')
		.slice(0, 40);
}

async function main() {
	loadDotenv();
	const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const emailArg = process.argv[2] || process.env.OFFICER_EMAIL || 'mrfadhilimlanzi@gmail.com';
	const email = emailArg.trim().toLowerCase();

	if (!url || !serviceKey) {
		console.error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY in .env');
		process.exit(1);
	}

	const supabase = createClient(url, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { data: officer, error: officerErr } = await supabase
		.from('users')
		.select('id, email, full_name, role, branch_id, is_active')
		.ilike('email', email)
		.maybeSingle();

	if (officerErr) {
		console.error('Lookup failed:', officerErr.message);
		process.exit(1);
	}
	if (!officer) {
		console.error(`No user found with email: ${email}`);
		process.exit(1);
	}
	if (officer.role !== 'officer') {
		console.warn(`Warning: user role is "${officer.role}", not officer — continuing anyway.`);
	}

	console.log(`Officer: ${officer.full_name ?? '(no name)'} <${officer.email}>`);

	const { data: cfgRows } = await supabase.from('system_config').select('key, value').eq('key', 'currency');
	const currency = cfgRows?.[0]?.value || 'TZS';

	const officerId = officer.id;

	const repayments = await fetchAllRowsPaged((from, to) =>
		supabase
			.from('repayments')
			.select(REP_SELECT)
			.eq('officer_id', officerId)
			.order('actual_payment_date', { ascending: false })
			.order('created_at', { ascending: false })
			.order('id', { ascending: true })
			.range(from, to),
	);

	const fieldTakenRows = await fetchAllRowsPaged((from, to) =>
		supabase
			.from('officer_field_taken')
			.select('id, officer_id, business_date, amount_taken, created_at')
			.eq('officer_id', officerId)
			.order('business_date', { ascending: false })
			.range(from, to),
	);

	const withdrawRows = await fetchAllRowsPaged((from, to) =>
		supabase
			.from('officer_withdraw_to_bank')
			.select(
				'id, officer_id, business_date, created_at, amount_deposited, closing_deposit, carried_to_next_day, planned_next_day_taken, top_up_from_office, next_business_date',
			)
			.eq('officer_id', officerId)
			.order('business_date', { ascending: false })
			.range(from, to),
	);

	const expenses = await fetchAllRowsPaged((from, to) =>
		supabase
			.from('expenses')
			.select('id, amount, expense_type, description, expense_date, officer_id')
			.eq('officer_id', officerId)
			.order('expense_date', { ascending: false })
			.range(from, to),
	);

	const disbursements = await fetchAllRowsPaged((from, to) =>
		supabase
			.from('loans')
			.select(LOAN_SELECT)
			.eq('officer_id', officerId)
			.order('disbursement_date', { ascending: false })
			.range(from, to),
	);

	const dailyDates = lastThreeEatDates();
	const dailySet = new Set(dailyDates);
	const repaymentsByDate = new Map(dailyDates.map((d) => [d, []]));

	for (const r of repayments) {
		const d = String(r.actual_payment_date ?? r.payment_date ?? '').slice(0, 10);
		if (dailySet.has(d)) {
			repaymentsByDate.get(d).push(r);
		}
	}

	for (const [d, list] of repaymentsByDate) {
		repaymentsByDate.set(d, sortRepaymentsNewestFirst(list));
	}

	const allRepayments = sortRepaymentsNewestFirst(repayments);
	const walletHistoryRows = buildWalletHistoryRows({
		fieldTakenRows,
		withdrawRows,
		expenses,
		disbursements,
	});

	console.log(
		`Loaded: ${repayments.length} repayments, ${fieldTakenRows.length} taken, ${withdrawRows.length} withdraws, ${expenses.length} expenses, ${disbursements.length} disbursements`,
	);

	const todayStr = todayEAT();
	const slug = safeFileSlug(officer.full_name);
	const outPath = join(homedir(), 'Desktop', `${slug}_wallet_${todayStr}.xlsx`);

	const workbook = await buildOfficerWalletWorkbook({
		officer,
		currency,
		dailyDates,
		repaymentsByDate,
		allRepayments,
		walletHistoryRows,
	});

	await writeWorkbookToPath(workbook, outPath);
	console.log(`Saved: ${outPath}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});

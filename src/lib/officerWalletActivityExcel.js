import ExcelJS from 'exceljs';
import { scheduledCollectionAmount, prepaymentAmount } from './repaymentPrepayment.js';

const REPAYMENT_HEADERS = [
	'Payment date',
	'Recorded at',
	'Borrower',
	'Loan ID',
	'Center',
	'Group',
	'Scheduled',
	'Prepayment',
	'Total',
	'Due snapshot',
	'Split source',
];

const WALLET_HISTORY_HEADERS = ['Type', 'Date', 'Amount', 'Details'];

function thinBorder() {
	return {
		top: { style: 'thin' },
		left: { style: 'thin' },
		bottom: { style: 'thin' },
		right: { style: 'thin' },
	};
}

const greyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const yellowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

function num(n) {
	const x = Number(n);
	return Number.isFinite(x) ? x : 0;
}

function borrowerName(repayment) {
	const b = repayment?.loans?.borrowers;
	if (!b) return '';
	return `${b.first_name ?? ''} ${b.surname ?? ''}`.trim();
}

function centerName(repayment) {
	return repayment?.loans?.borrowers?.groups?.centers?.name ?? '';
}

function groupName(repayment) {
	return repayment?.loans?.borrowers?.groups?.name ?? '';
}

function loanPublicId(repayment) {
	return repayment?.loans?.loan_id ?? '';
}

function paymentDateStr(repayment) {
	const d = repayment?.actual_payment_date ?? repayment?.payment_date;
	return d ? String(d).slice(0, 10) : '';
}

function recordedAtStr(repayment) {
	return repayment?.created_at ? String(repayment.created_at) : '';
}

/** @returns {Array<string|number>} */
export function repaymentRowValues(repayment, currency) {
	const sched = scheduledCollectionAmount(repayment);
	const prep = prepaymentAmount(repayment);
	const total = num(repayment?.amount);
	const snap = repayment?.scheduled_due_snapshot;
	return [
		paymentDateStr(repayment),
		recordedAtStr(repayment),
		borrowerName(repayment),
		loanPublicId(repayment),
		centerName(repayment),
		groupName(repayment),
		sched,
		prep,
		total,
		snap != null && snap !== '' ? num(snap) : '',
		repayment?.wallet_split_source ?? '',
	];
}

function writeHeaderRow(ws, headers, rowNum = 1) {
	const hr = ws.getRow(rowNum);
	headers.forEach((name, i) => {
		const c = hr.getCell(i + 1);
		c.value = name;
		c.font = { bold: true };
		c.fill = greyFill;
		c.border = thinBorder();
	});
	return rowNum + 1;
}

function writeRepaymentRows(ws, startRow, repayments, currency) {
	let r = startRow;
	let sumSched = 0;
	let sumPrep = 0;
	let sumTotal = 0;
	for (const rep of repayments) {
		const vals = repaymentRowValues(rep, currency);
		sumSched += num(vals[6]);
		sumPrep += num(vals[7]);
		sumTotal += num(vals[8]);
		const row = ws.getRow(r);
		vals.forEach((v, i) => {
			const c = row.getCell(i + 1);
			c.value = v;
			c.border = thinBorder();
			if (i >= 6 && i <= 8 && typeof v === 'number') {
				c.numFmt = '#,##0.00';
			}
		});
		r += 1;
	}
	if (repayments.length > 0) {
		const tr = ws.getRow(r);
		const totals = ['', '', '', '', '', 'TOTAL', sumSched, sumPrep, sumTotal, '', ''];
		totals.forEach((v, i) => {
			const c = tr.getCell(i + 1);
			c.value = v;
			c.font = { bold: true };
			c.fill = yellowFill;
			c.border = thinBorder();
			if (i >= 6 && i <= 8 && typeof v === 'number') {
				c.numFmt = '#,##0.00';
			}
		});
		r += 1;
	}
	return r;
}

function addRepaymentSheet(wb, sheetName, repayments, currency, officerLabel) {
	const safeName = sheetName.replace(/[\\/*?:[\]]/g, '-').slice(0, 31);
	const ws = wb.addWorksheet(safeName, { views: [{ showGridLines: true }] });
	[12, 22, 22, 14, 18, 16, 14, 14, 14, 14, 12].forEach((w, i) => {
		ws.getColumn(i + 1).width = w;
	});
	let r = 1;
	ws.mergeCells(r, 1, r, REPAYMENT_HEADERS.length);
	ws.getCell(r, 1).value = officerLabel;
	ws.getCell(r, 1).font = { bold: true, size: 12 };
	r += 1;
	r = writeHeaderRow(ws, REPAYMENT_HEADERS, r);
	writeRepaymentRows(ws, r, repayments, currency);
}

function addWalletHistorySheet(wb, rows, currency, officerLabel) {
	const ws = wb.addWorksheet('Wallet history', { views: [{ showGridLines: true }] });
	[18, 14, 16, 48].forEach((w, i) => {
		ws.getColumn(i + 1).width = w;
	});
	let r = 1;
	ws.mergeCells(r, 1, r, WALLET_HISTORY_HEADERS.length);
	ws.getCell(r, 1).value = `${officerLabel} — full wallet history`;
	ws.getCell(r, 1).font = { bold: true, size: 12 };
	r += 1;
	r = writeHeaderRow(ws, WALLET_HISTORY_HEADERS, r);
	for (const row of rows) {
		const dataRow = ws.getRow(r);
		[row.type, row.date, row.amount, row.details].forEach((v, i) => {
			const c = dataRow.getCell(i + 1);
			c.value = v;
			c.border = thinBorder();
			if (i === 2 && typeof v === 'number') c.numFmt = '#,##0.00';
		});
		r += 1;
	}
}

/**
 * @param {object} p
 * @param {{ full_name?: string, email?: string }} p.officer
 * @param {string} p.currency
 * @param {string[]} p.dailyDates - YYYY-MM-DD, one sheet each
 * @param {Map<string, object[]>} p.repaymentsByDate
 * @param {object[]} p.allRepayments - sorted newest first
 * @param {Array<{ type: string, date: string, amount: number, details: string, sortKey?: string }>} p.walletHistoryRows
 */
export async function buildOfficerWalletWorkbook({
	officer,
	currency,
	dailyDates,
	repaymentsByDate,
	allRepayments,
	walletHistoryRows,
}) {
	const officerLabel = `${officer?.full_name ?? 'Officer'} (${officer?.email ?? ''})`;
	const wb = new ExcelJS.Workbook();
	wb.creator = 'FCL';
	wb.created = new Date();

	for (const dateKey of dailyDates) {
		const reps = repaymentsByDate.get(dateKey) ?? [];
		addRepaymentSheet(wb, dateKey, reps, currency, `${officerLabel} — ${dateKey}`);
	}

	addRepaymentSheet(wb, 'All repayments', allRepayments, currency, `${officerLabel} — all repayments`);
	addWalletHistorySheet(wb, walletHistoryRows, currency, officerLabel);

	return wb;
}

/** @param {ExcelJS.Workbook} workbook */
export async function writeWorkbookToPath(workbook, absolutePath) {
	const buf = await workbook.xlsx.writeBuffer();
	const { writeFileSync } = await import('fs');
	writeFileSync(absolutePath, Buffer.from(buf));
}

/** Build unified wallet history rows (non-repayment cash + repayment summary lines optional). */
export function buildWalletHistoryRows({
	fieldTakenRows = [],
	withdrawRows = [],
	expenses = [],
	disbursements = [],
}) {
	const out = [];

	for (const t of fieldTakenRows) {
		out.push({
			type: 'Cash taken',
			date: String(t.business_date ?? '').slice(0, 10),
			amount: num(t.amount_taken),
			details: 'Field float taken from office',
			sortKey: `${t.business_date}T00:00:00`,
		});
	}
	for (const w of withdrawRows) {
		const banked = num(w.amount_deposited);
		const carried = num(w.carried_to_next_day);
		const topUp = num(w.top_up_from_office);
		const parts = [`Deposited to bank: ${banked.toFixed(2)}`];
		if (carried > 0) parts.push(`Carried to next day: ${carried.toFixed(2)}`);
		if (topUp > 0) parts.push(`Top-up from office: ${topUp.toFixed(2)}`);
		out.push({
			type: 'Withdraw to bank',
			date: String(w.business_date ?? '').slice(0, 10),
			amount: banked,
			details: parts.join('; '),
			sortKey: w.created_at ?? `${w.business_date}T23:59:59`,
		});
	}
	for (const e of expenses) {
		out.push({
			type: 'Expense',
			date: String(e.expense_date ?? '').slice(0, 10),
			amount: -num(e.amount),
			details: [e.expense_type, e.description].filter(Boolean).join(' — '),
			sortKey: `${e.expense_date}T12:00:00`,
		});
	}
	for (const l of disbursements) {
		const name = l.borrowers
			? `${l.borrowers.first_name ?? ''} ${l.borrowers.surname ?? ''}`.trim()
			: '';
		out.push({
			type: 'Disbursement',
			date: String(l.disbursement_date ?? '').slice(0, 10),
			amount: -num(l.principal),
			details: [l.loan_id, name].filter(Boolean).join(' — '),
			sortKey: `${l.disbursement_date}T12:00:00`,
		});
	}

	out.sort((a, b) => String(b.sortKey ?? b.date).localeCompare(String(a.sortKey ?? a.date)));
	return out.map(({ type, date, amount, details }) => ({ type, date, amount, details }));
}

export function sortRepaymentsNewestFirst(repayments) {
	return [...repayments].sort((a, b) => {
		const da = paymentDateStr(a);
		const db = paymentDateStr(b);
		if (da !== db) return db.localeCompare(da);
		return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
	});
}

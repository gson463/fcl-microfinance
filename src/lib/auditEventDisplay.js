/**
 * Human-readable lines for admin Activity log / audit tables.
 * Server rows may return metadata as object or (rarely) JSON string.
 */

export function normalizeAuditMetadata(raw) {
	if (raw == null) return {};
	if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
	if (typeof raw === 'string') {
		try {
			const p = JSON.parse(raw);
			return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
		} catch {
			return {};
		}
	}
	return {};
}

function fmtNum(n) {
	if (n == null || n === '') return null;
	const x = Number(n);
	return Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(n);
}

/**
 * One clear sentence describing what the row means for non-technical readers.
 */
export function formatAuditEventSummary(row) {
	const action = row?.action ?? '';
	const entityType = row?.entity_type ?? '';
	const entityId = row?.entity_id != null ? String(row.entity_id) : '';
	const m = normalizeAuditMetadata(row?.metadata);

	if (action === 'auth.login') {
		return m.email ? `Signed in: ${String(m.email)}` : 'Signed in';
	}
	if (action === 'auth.logout') {
		if (m.reason === 'idle_timeout') return 'Signed out automatically (inactivity timeout)';
		return 'Signed out';
	}
	if (action === 'policy.consent.accepted') {
		const v = m.policy_version != null ? String(m.policy_version) : '';
		return v ? `Security terms accepted (v${v})` : 'Security terms accepted';
	}
	if (action === 'repayment.record') {
		const bits = [];
		const amt = fmtNum(m.amount);
		if (amt) bits.push(`amount ${amt}`);
		if (m.actual_payment_date) bits.push(`paid on ${m.actual_payment_date}`);
		const prep = fmtNum(m.prepayment_amount);
		if (prep && Number(m.prepayment_amount) > 0) bits.push(`prepayment ${prep}`);
		const due = fmtNum(m.scheduled_due_snapshot);
		if (due && Number(m.scheduled_due_snapshot) > 0) bits.push(`scheduled/arrears ${due}`);
		if (m.wallet_split === 'explicit') bits.push('wallet split: explicit');
		const loanBit = entityId ? `Loan ${entityId.slice(0, 8)}…` : 'loan';
		const detail = bits.length ? bits.join(' · ') : 'collection recorded';
		return `Repayment: ${detail} (${loanBit})`;
	}
	if (action === 'loan.disburse') {
		const p = fmtNum(m.principal);
		const pub = m.loan_public_id ? String(m.loan_public_id) : '';
		const bid = m.borrower_public_id ? String(m.borrower_public_id) : '';
		const parts = [];
		if (p) parts.push(`principal ${p}`);
		if (pub) parts.push(pub);
		if (bid) parts.push(`borrower ${bid}`);
		if (m.disbursement_date) parts.push(`disbursed ${m.disbursement_date}`);
		return parts.length ? `Loan disbursed: ${parts.join(' · ')}` : 'Loan disbursed';
	}
	if (action === 'loan.disburse_bulk') {
		const n = m.count != null ? Number(m.count) : 0;
		const d = m.disbursement_date ? String(m.disbursement_date) : '';
		return d ? `Bulk loans disbursed: ${n} loan(s) · ${d}` : `Bulk loans disbursed: ${n} loan(s)`;
	}
	if (action === 'borrower.create') {
		const id = m.borrower_public_id ? String(m.borrower_public_id) : '';
		const name = m.name ? String(m.name).trim() : '';
		if (id && name) return `Borrower registered: ${id} · ${name}`;
		if (id) return `Borrower registered: ${id}`;
		if (name) return `Borrower registered: ${name}`;
		return 'Borrower registered';
	}
	if (action === 'borrower.update') {
		const id = m.borrower_public_id ? String(m.borrower_public_id) : '';
		return id ? `Borrower profile updated: ${id}` : 'Borrower profile updated';
	}
	if (action === 'borrower.delete') {
		const id = m.borrower_public_id ? String(m.borrower_public_id) : '';
		return id ? `Borrower removed: ${id}` : 'Borrower removed';
	}

	if (action === 'loan.delete.requested') {
		const pub = entityId || m.loan_uuid || '';
		return pub
			? `Loan deletion requested (awaiting manager) · ${pub}`
			: 'Loan deletion requested (awaiting manager)';
	}
	if (action === 'loan.delete.finalized') {
		const name = m.borrower_name ? String(m.borrower_name) : '';
		const loanRef = entityId ? String(entityId) : '';
		const parts = ['Loan permanently deleted'];
		if (loanRef) parts.push(loanRef);
		if (name) parts.push(name);
		return parts.join(' · ');
	}
	if (action === 'repayment.delete.requested') {
		const lp = m.loan_public_id ? String(m.loan_public_id) : '';
		return lp ? `Repayment deletion requested · loan ${lp}` : 'Repayment deletion requested';
	}
	if (action === 'repayment.delete.finalized') {
		const lp = m.loan_public_id ? String(m.loan_public_id) : '';
		const name = m.borrower_name ? String(m.borrower_name) : '';
		const bits = ['Repayment removed (manager approved)'];
		if (lp) bits.push(`loan ${lp}`);
		if (name) bits.push(name);
		return bits.join(' · ');
	}
	if (action === 'repayment.delete.rejected') {
		return 'Repayment deletion rejected by manager';
	}
	if (action === 'user.delete.success') return 'User account deleted (admin)';
	if (action === 'user.delete.failed') {
		return `User delete failed${m.error ? `: ${String(m.error).slice(0, 120)}` : ''}`;
	}
	if (action === 'loan_officer.delete.success') return 'Loan officer account deleted';
	if (action === 'loan_officer.delete.failed') {
		return `Loan officer delete failed${m.error ? `: ${String(m.error).slice(0, 120)}` : ''}`;
	}

	const bits = [action, entityType, entityId].filter(Boolean);
	const base = bits.join(' · ');
	const keys = Object.keys(m);
	if (keys.length === 0) return base || action || '—';
	const extra = keys
		.slice(0, 5)
		.map((k) => {
			const v = m[k];
			const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
			return `${k}: ${s.length > 80 ? `${s.slice(0, 80)}…` : s}`;
		})
		.join(' · ');
	return base ? `${base} — ${extra}` : extra;
}

export function auditMetadataJsonString(m) {
	const obj = normalizeAuditMetadata(m);
	try {
		const s = JSON.stringify(obj);
		return s === '{}' ? '' : s;
	} catch {
		return '';
	}
}

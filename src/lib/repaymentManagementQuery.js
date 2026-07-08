import { startOfDay, endOfDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { prepaymentAmount, scheduledCollectionAmount } from '@/lib/repaymentPrepayment';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import { fetchAllSupabaseRows } from '@/lib/supabaseFetchAllRows';

const EAT_TIMEZONE = 'Africa/Nairobi';

export const REPAYMENT_PAGE_SIZE = 25;

/** Default list filter: actual payment date = today (EAT). Use date picker for history. */
export function defaultRepaymentDateRange() {
    const s = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
    const [y, m, d] = s.split('-').map(Number);
    const today = new Date(y, m - 1, d);
    return { from: today, to: today };
}

/** Columns needed for the repayment table (avoids nested groups when not filtering). */
export const REPAYMENT_LIST_SELECT =
    'id, loan_id, officer_id, borrower_id, amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, interest_paid, principal_paid, actual_payment_date, payment_date, loans(id, borrower_id, loan_id, borrowers(id, borrower_id, first_name, surname, status, center_id, group_id, groups(id, name, center_id)))';

export const REPAYMENT_STATS_SELECT =
    'amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, interest_paid, principal_paid';

/** Loans for record picker / outstanding stats — no schedule JSONB on initial load. */
export const LOAN_PICKER_SELECT =
    'id, loan_id, status, principal, balance, total_payable, borrower_id, officer_id, borrowers(*, groups(*))';

export function dateRangeToQueryBounds(dateRange) {
    if (!dateRange?.from) return { from: null, to: null };
    const from = formatInTimeZone(startOfDay(dateRange.from), EAT_TIMEZONE, 'yyyy-MM-dd');
    const to = formatInTimeZone(endOfDay(dateRange.to || dateRange.from), EAT_TIMEZONE, 'yyyy-MM-dd');
    return { from, to };
}

/** True when filter is a single calendar day matching today in EAT. */
export function isTodayRepaymentDateRange(dateRange) {
    if (!dateRange?.from) return false;
    const todayStr = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
    const { from, to } = dateRangeToQueryBounds(dateRange);
    return from === todayStr && to === todayStr;
}

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

function hasLocationFilter({ centerFilter = 'all', groupFilter = 'all', borrowerStatusFilter = 'all' } = {}) {
    return centerFilter !== 'all' || groupFilter !== 'all' || borrowerStatusFilter !== 'all';
}

function officerScopeFromFilters(filters) {
    return {
        singleOfficerId:
            filters.singleOfficerId ??
            (filters.officerFilter && filters.officerFilter !== 'all' ? filters.officerFilter : undefined),
        officerIds: filters.officerIds,
    };
}

/** Intersect search + location loan ID sets; null = no constraint on that side. */
export function intersectLoanIds(a, b) {
    if (a === null && b === null) return null;
    if (a === null) return b;
    if (b === null) return a;
    const setB = new Set(b);
    return a.filter((id) => setB.has(id));
}

/**
 * Loan IDs matching center / group / borrower status (aligned with borrowerMatchesCenter/Group).
 * @returns {Promise<null | string[]>} null = no location filter; [] = no matches
 */
export async function resolveLocationLoanIds(supabase, filters, scope = {}) {
    const centerFilter = filters.centerFilter ?? 'all';
    const groupFilter = filters.groupFilter ?? 'all';
    const borrowerStatusFilter = filters.borrowerStatusFilter ?? 'all';
    if (!hasLocationFilter({ centerFilter, groupFilter, borrowerStatusFilter })) return null;

    let query = supabase
        .from('loans')
        .select('id, borrowers!inner(id, center_id, group_id, status, groups(center_id))');

    if (scope.singleOfficerId) {
        query = query.eq('officer_id', scope.singleOfficerId);
    } else if (scope.officerIds?.length) {
        query = query.in('officer_id', scope.officerIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? [])
        .filter((row) => {
            const b = row.borrowers;
            if (!b) return false;
            if (borrowerStatusFilter !== 'all' && b.status !== borrowerStatusFilter) return false;
            if (!borrowerMatchesGroup(b, groupFilter)) return false;
            if (!borrowerMatchesCenter(b, centerFilter)) return false;
            return true;
        })
        .map((row) => row.id);
}

async function resolveEffectiveLoanIds(supabase, filters) {
    const scope = officerScopeFromFilters(filters);
    const [searchLoanIds, locationLoanIds] = await Promise.all([
        filters.searchTerm != null && String(filters.searchTerm).trim()
            ? resolveSearchLoanIds(supabase, filters.searchTerm, scope)
            : null,
        hasLocationFilter(filters) ? resolveLocationLoanIds(supabase, filters, scope) : null,
    ]);
    return intersectLoanIds(searchLoanIds, locationLoanIds);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} filters
 * @param {{ countOnly?: boolean, statsOnly?: boolean }} [options]
 */
/** @param {object} filters
 *  @param {string} [filters.singleOfficerId]
 *  @param {string[] | null | undefined} [filters.officerIds] — null/undefined = no officer scope (admin all branches)
 *  @param {string} [filters.officerFilter]
 *  @param {null | string[]} [filters.effectiveLoanIds] — pre-resolved loan_id filter (search + location)
 */
export function buildRepaymentListQuery(supabase, filters, { countOnly = false, statsOnly = false } = {}) {
    const { singleOfficerId, officerIds, officerFilter, dateRange, effectiveLoanIds } = filters;

    const select = statsOnly ? REPAYMENT_STATS_SELECT : countOnly ? 'id' : REPAYMENT_LIST_SELECT;

    let query = supabase.from('repayments').select(select, { count: countOnly ? 'exact' : 'exact', head: countOnly });

    if (singleOfficerId) {
        query = query.eq('officer_id', singleOfficerId);
    } else if (officerFilter && officerFilter !== 'all') {
        query = query.eq('officer_id', officerFilter);
    } else if (officerIds) {
        if (officerIds.length === 0) {
            query = query.eq('officer_id', EMPTY_UUID);
        } else {
            query = query.in('officer_id', officerIds);
        }
    }

    if (dateRange?.from) {
        const { from, to } = dateRangeToQueryBounds(dateRange);
        if (from) query = query.gte('actual_payment_date', from);
        if (to) query = query.lte('actual_payment_date', to);
    }

    if (effectiveLoanIds === null) {
        // no loan_id constraint
    } else if (effectiveLoanIds.length === 0) {
        query = query.eq('id', EMPTY_UUID);
    } else {
        query = query.in('loan_id', effectiveLoanIds);
    }

    return query;
}

/**
 * Resolve loan IDs matching search term within officer scope.
 * @returns {Promise<null | string[]>} null = no search active; [] = no matches
 */
export async function resolveSearchLoanIds(supabase, searchTerm, scope = {}) {
    const trimmed = String(searchTerm ?? '').trim();
    if (!trimmed) return null;

    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const term = `%${escaped}%`;

    let query = supabase
        .from('loans')
        .select('id, borrowers!inner(id)')
        .or(
            `loan_id.ilike.${term},borrowers.first_name.ilike.${term},borrowers.surname.ilike.${term},borrowers.borrower_id.ilike.${term}`,
        )
        .limit(500);

    if (scope.singleOfficerId) {
        query = query.eq('officer_id', scope.singleOfficerId);
    } else if (scope.officerIds?.length) {
        query = query.in('officer_id', scope.officerIds);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => row.id);
}

/**
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient, filters: object, page: number, pageSize?: number }} params
 */
export async function fetchRepaymentPage({ supabase, filters, page, pageSize = REPAYMENT_PAGE_SIZE }) {
    const effectiveLoanIds = await resolveEffectiveLoanIds(supabase, filters);
    const queryFilters = { ...filters, effectiveLoanIds };
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await buildRepaymentListQuery(supabase, queryFilters)
        .order('actual_payment_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);

    if (error) throw error;
    return { rows: data ?? [], totalCount: count ?? 0 };
}

/** Slim rows for stats aggregation within the active filter window. */
export async function fetchRepaymentStatsRows({ supabase, filters }) {
    const effectiveLoanIds = await resolveEffectiveLoanIds(supabase, filters);
    const queryFilters = { ...filters, effectiveLoanIds };
    return fetchAllSupabaseRows(() =>
        buildRepaymentListQuery(supabase, queryFilters, { statsOnly: true }).order('id', { ascending: true }),
    );
}

export function aggregateRepaymentStats(rows) {
    const list = rows ?? [];
    return {
        totalPaid: list.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
        totalPrepayment: list.reduce((sum, r) => sum + prepaymentAmount(r), 0),
        totalScheduledCollection: list.reduce((sum, r) => sum + scheduledCollectionAmount(r), 0),
        totalInterest: list.reduce((sum, r) => sum + Number(r.interest_paid ?? 0), 0),
        totalPrincipalPaid: list.reduce((sum, r) => sum + Number(r.principal_paid ?? 0), 0),
    };
}

/** Fetch all rows matching filters (for CSV/XLSX export). */
export async function fetchAllFilteredRepayments({ supabase, filters }) {
    const effectiveLoanIds = await resolveEffectiveLoanIds(supabase, filters);
    const queryFilters = { ...filters, effectiveLoanIds };
    return fetchAllSupabaseRows(() =>
        buildRepaymentListQuery(supabase, queryFilters)
            .order('actual_payment_date', { ascending: false })
            .order('id', { ascending: false }),
    );
}

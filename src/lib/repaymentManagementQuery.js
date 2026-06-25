import { startOfDay, endOfDay, subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { prepaymentAmount, scheduledCollectionAmount } from '@/lib/repaymentPrepayment';
import { fetchAllSupabaseRows } from '@/lib/supabaseFetchAllRows';

const EAT_TIMEZONE = 'Africa/Nairobi';

export const REPAYMENT_PAGE_SIZE = 25;
export const REPAYMENT_DEFAULT_LOOKBACK_DAYS = 90;

/** Columns needed for the repayment table (avoids nested groups when not filtering). */
export const REPAYMENT_LIST_SELECT =
    'id, loan_id, officer_id, borrower_id, amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, interest_paid, principal_paid, actual_payment_date, payment_date, loans(id, borrower_id, loan_id, borrowers(id, borrower_id, first_name, surname, status, center_id, group_id, groups(id, name, center_id)))';

export const REPAYMENT_STATS_SELECT =
    'amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, interest_paid, principal_paid';

/** Loans for record picker / outstanding stats — no schedule JSONB on initial load. */
export const LOAN_PICKER_SELECT =
    'id, loan_id, status, principal, balance, total_payable, borrower_id, officer_id, borrowers(*, groups(*))';

export function defaultRepaymentDateRange() {
    const to = new Date();
    const from = subDays(to, REPAYMENT_DEFAULT_LOOKBACK_DAYS);
    return { from, to };
}

export function dateRangeToQueryBounds(dateRange) {
    if (!dateRange?.from) return { from: null, to: null };
    const from = formatInTimeZone(startOfDay(dateRange.from), EAT_TIMEZONE, 'yyyy-MM-dd');
    const to = formatInTimeZone(endOfDay(dateRange.to || dateRange.from), EAT_TIMEZONE, 'yyyy-MM-dd');
    return { from, to };
}

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

function repaymentListSelect({ centerFilter, groupFilter, borrowerStatusFilter }) {
    const needsBorrowerJoin =
        centerFilter !== 'all' || groupFilter !== 'all' || borrowerStatusFilter !== 'all';
    if (!needsBorrowerJoin) return REPAYMENT_LIST_SELECT;
    return REPAYMENT_LIST_SELECT.replace('loans(', 'loans!inner(').replace(
        'borrowers(',
        'borrowers!inner(',
    );
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
 */
export function buildRepaymentListQuery(supabase, filters, { countOnly = false, statsOnly = false } = {}) {
    const {
        singleOfficerId,
        officerIds,
        officerFilter,
        dateRange,
        loadAllHistory,
        centerFilter = 'all',
        groupFilter = 'all',
        borrowerStatusFilter = 'all',
        searchLoanIds,
    } = filters;

    const select = statsOnly
        ? REPAYMENT_STATS_SELECT
        : countOnly
          ? 'id'
          : repaymentListSelect({ centerFilter, groupFilter, borrowerStatusFilter });

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

    if (!loadAllHistory) {
        const { from, to } = dateRangeToQueryBounds(dateRange);
        if (from) query = query.gte('actual_payment_date', from);
        if (to) query = query.lte('actual_payment_date', to);
    }

    if (centerFilter !== 'all') {
        query = query.eq('loans.borrowers.center_id', centerFilter);
    }
    if (groupFilter !== 'all') {
        query = query.eq('loans.borrowers.group_id', groupFilter);
    }
    if (borrowerStatusFilter !== 'all') {
        query = query.eq('loans.borrowers.status', borrowerStatusFilter);
    }

    if (searchLoanIds === null) {
        // no search constraint
    } else if (searchLoanIds.length === 0) {
        query = query.eq('id', EMPTY_UUID);
    } else {
        query = query.in('loan_id', searchLoanIds);
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
    const searchLoanIds =
        filters.searchTerm != null && String(filters.searchTerm).trim()
            ? await resolveSearchLoanIds(supabase, filters.searchTerm, {
                  singleOfficerId:
                      filters.singleOfficerId ??
                      (filters.officerFilter && filters.officerFilter !== 'all'
                          ? filters.officerFilter
                          : undefined),
                  officerIds: filters.officerIds,
              })
            : null;

    const queryFilters = { ...filters, searchLoanIds };
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
    const searchLoanIds =
        filters.searchTerm != null && String(filters.searchTerm).trim()
            ? await resolveSearchLoanIds(supabase, filters.searchTerm, {
                  singleOfficerId:
                      filters.singleOfficerId ??
                      (filters.officerFilter && filters.officerFilter !== 'all'
                          ? filters.officerFilter
                          : undefined),
                  officerIds: filters.officerIds,
              })
            : null;

    const queryFilters = { ...filters, searchLoanIds };
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
    const searchLoanIds =
        filters.searchTerm != null && String(filters.searchTerm).trim()
            ? await resolveSearchLoanIds(supabase, filters.searchTerm, {
                  singleOfficerId:
                      filters.singleOfficerId ??
                      (filters.officerFilter && filters.officerFilter !== 'all'
                          ? filters.officerFilter
                          : undefined),
                  officerIds: filters.officerIds,
              })
            : null;

    const queryFilters = { ...filters, searchLoanIds };
    return fetchAllSupabaseRows(() =>
        buildRepaymentListQuery(supabase, queryFilters)
            .order('actual_payment_date', { ascending: false })
            .order('id', { ascending: false }),
    );
}

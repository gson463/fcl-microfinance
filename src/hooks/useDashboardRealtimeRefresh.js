import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Refetches dashboard data when loans or repayments change via Supabase Realtime.
 * Tables must be on publication supabase_realtime (see migration realtime_loans_repayments_dashboard).
 *
 * @param {() => void} onRefresh - Called debounced after relevant DB changes (also once when tab becomes visible).
 * @param {{ enabled?: boolean, officerIdEq?: string | null, debounceMs?: number }} [options]
 */
export function useDashboardRealtimeRefresh(onRefresh, options = {}) {
	const { enabled = true, officerIdEq = null, debounceMs = 400 } = options;

	const onRefreshRef = useRef(onRefresh);
	onRefreshRef.current = onRefresh;

	useEffect(() => {
		if (!enabled) return undefined;

		let debounceTimer;
		const run = () => {
			if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				onRefreshRef.current?.();
			}, debounceMs);
		};

		const loansCfg =
			officerIdEq != null && officerIdEq !== ''
				? { event: '*', schema: 'public', table: 'loans', filter: `officer_id=eq.${officerIdEq}` }
				: { event: '*', schema: 'public', table: 'loans' };

		const repaymentsCfg =
			officerIdEq != null && officerIdEq !== ''
				? { event: '*', schema: 'public', table: 'repayments', filter: `officer_id=eq.${officerIdEq}` }
				: { event: '*', schema: 'public', table: 'repayments' };

		const channelName = `dashboard-live:${officerIdEq ?? 'all'}:${Math.random().toString(36).slice(2)}`;
		const channel = supabase
			.channel(channelName)
			.on('postgres_changes', loansCfg, run)
			.on('postgres_changes', repaymentsCfg, run);

		channel.subscribe();

		const onVis = () => {
			if (document.visibilityState === 'visible') run();
		};
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', onVis);
		}

		return () => {
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', onVis);
			}
			clearTimeout(debounceTimer);
			supabase.removeChannel(channel);
		};
	}, [enabled, officerIdEq, debounceMs]);
}

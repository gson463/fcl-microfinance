import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { hasStoredAdminImpersonationBackup } from '@/lib/adminImpersonation';
import { Button } from '@/components/ui/button';

const EAT = 'Africa/Nairobi';

export const OFFICER_DAY_CLOSED_ALLOWED_PREFIXES = [
  '/officer/dashboard',
  '/officer/field-wallet',
  '/reports',
];

export const OFFICER_WITHDRAW_RECORDED_EVENT = 'officer-withdraw-recorded';

const OfficerDayClosedContext = createContext({
  locked: false,
  loading: true,
  lockEnabled: true,
  nextWorkingDate: null,
  withdrawDate: null,
  message: null,
  refresh: () => {},
});

export function useOfficerDayClosed() {
  return useContext(OfficerDayClosedContext);
}

function isAllowedPath(pathname) {
  return OFFICER_DAY_CLOSED_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function OfficerDayClosedProvider({ children }) {
  const { user } = useAuth();
  const role = user?.user_metadata?.role;
  const [state, setState] = useState({
    locked: false,
    loading: true,
    lockEnabled: true,
    nextWorkingDate: null,
    withdrawDate: null,
    message: null,
  });

  const refresh = useCallback(async () => {
    if (role !== 'officer' || !user?.id) {
      setState({
        locked: false,
        loading: false,
        lockEnabled: true,
        nextWorkingDate: null,
        withdrawDate: null,
        message: null,
      });
      return;
    }

    if (hasStoredAdminImpersonationBackup()) {
      setState({
        locked: false,
        loading: false,
        lockEnabled: true,
        nextWorkingDate: null,
        withdrawDate: null,
        message: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    try {
      const today = formatInTimeZone(new Date(), EAT, 'yyyy-MM-dd');
      const { data, error } = await supabase.rpc('officer_is_day_closed_after_withdraw', {
        p_business_date: today,
      });
      if (error) throw error;

      setState({
        locked: !!data?.locked,
        loading: false,
        lockEnabled: data?.lock_enabled !== false,
        nextWorkingDate: data?.next_working_date ?? null,
        withdrawDate: data?.withdraw_date ?? null,
        message: data?.message ?? null,
      });
    } catch (e) {
      console.error('OfficerDayClosedProvider:', e);
      setState({
        locked: false,
        loading: false,
        lockEnabled: true,
        nextWorkingDate: null,
        withdrawDate: null,
        message: null,
      });
    }
  }, [role, user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (role !== 'officer' || !user?.id) return undefined;

    const onWithdraw = () => refresh();
    window.addEventListener(OFFICER_WITHDRAW_RECORDED_EVENT, onWithdraw);

    const today = formatInTimeZone(new Date(), EAT, 'yyyy-MM-dd');
    const channel = supabase
      .channel(`officer-day-closed-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'officer_withdraw_to_bank',
          filter: `officer_id=eq.${user.id}`,
        },
        () => refresh()
      )
      .subscribe();

    return () => {
      window.removeEventListener(OFFICER_WITHDRAW_RECORDED_EVENT, onWithdraw);
      supabase.removeChannel(channel);
    };
  }, [role, user?.id, refresh]);

  const value = useMemo(
    () => ({
      ...state,
      refresh,
    }),
    [state, refresh]
  );

  return <OfficerDayClosedContext.Provider value={value}>{children}</OfficerDayClosedContext.Provider>;
}

/** Blocks officer navigation to write routes after withdraw; shows banner on allowed read-only routes. */
export function OfficerDayClosedGate() {
  const { user, signOut } = useAuth();
  const role = user?.user_metadata?.role;
  const location = useLocation();
  const navigate = useNavigate();
  const { locked, loading, nextWorkingDate, message } = useOfficerDayClosed();

  if (role !== 'officer' || loading || !locked) {
    return null;
  }

  const allowedHere = isAllowedPath(location.pathname);

  if (!allowedHere) {
    return (
      <div
        className="fixed inset-0 z-[190] flex flex-col items-center justify-center gap-6 bg-background/95 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="officer-day-closed-title"
      >
        <div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" aria-hidden />
            <div>
              <h2 id="officer-day-closed-title" className="text-lg font-semibold tracking-tight">
                Siku ya kazi imefungwa
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {message ||
                  'Umeconfirm withdraw to bank. Hutaweza kufanya shughuli zaidi hadi siku ya kazi inayofuata.'}
              </p>
              {nextWorkingDate && (
                <p className="mt-2 text-sm font-medium">
                  Endelea: <span className="tabular-nums">{nextWorkingDate}</span>
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Unaweza kuangalia Dashboard, Field wallet, na Reports tu (read-only).
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
            <Button type="button" onClick={() => navigate('/officer/dashboard', { replace: true })}>
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-[180] border-b border-amber-500/50 bg-amber-500/15 px-4 py-2.5 text-center text-sm text-amber-950 dark:bg-amber-950/50 dark:text-amber-50 lg:pl-72"
    >
      <span className="inline-flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        Day closed after withdraw — view only until next working day
        {nextWorkingDate ? ` (${nextWorkingDate})` : ''}
      </span>
    </div>
  );
}

export default OfficerDayClosedGate;

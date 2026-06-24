import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
const EAT = 'Africa/Nairobi';

const NO_WORK_ACK_PREFIX = 'officer_no_work_ack_';

function todayYyyyMmDdEAT() {
  return formatInTimeZone(new Date(), EAT, 'yyyy-MM-dd');
}

/** Previous calendar day for a yyyy-MM-dd string (UTC date math, no timezone drift). */
function previousCalendarDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function parseAmountInput(s) {
  const t = String(s ?? '')
    .trim()
    .replace(/,/g, '');
  if (t === '') return 0;
  const n = Number.parseFloat(t);
  return Number.isNaN(n) ? NaN : n;
}

/** Whether the current instant falls on a Sunday in Africa/Nairobi. */
function isSundayEAT() {
  const long = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: EAT }).format(new Date());
  return long === 'Sunday';
}

function normalizeHolidayDate(h) {
  if (h == null || h.date == null) return '';
  return typeof h.date === 'string' ? h.date.slice(0, 10) : String(h.date).slice(0, 10);
}

/**
 * Loan officers: on working days, must record "taken" (float) before using the app.
 * On Sundays and configured public holidays, shows "No work today" with OK (no taken required).
 * Prefilled taken from end-of-day withdraw requires confirm on first login that working day.
 */
const OfficerTakenGate = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const role = user?.user_metadata?.role;
  const [resolved, setResolved] = useState(false);
  const [needsGate, setNeedsGate] = useState(false);
  const [showNoWorkModal, setShowNoWorkModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [todayStr, setTodayStr] = useState('');
  /** Row prefilled at withdraw; needs confirm (confirmed_at null). */
  const [prefilledRow, setPrefilledRow] = useState(null);

  const [yesterdayDeposit, setYesterdayDeposit] = useState(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [mode, setMode] = useState('use_deposit');
  const [extraOnTop, setExtraOnTop] = useState('');
  const [manualTaken, setManualTaken] = useState('');

  const checkToday = useCallback(async () => {
    if (role !== 'officer') {
      setResolved(true);
      setNeedsGate(false);
      setShowNoWorkModal(false);
      setPrefilledRow(null);
      return;
    }
    if (!user?.id) {
      setResolved(true);
      setNeedsGate(false);
      setShowNoWorkModal(false);
      setPrefilledRow(null);
      return;
    }
    setResolved(false);
    const d = todayYyyyMmDdEAT();
    setTodayStr(d);

    const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('date');
    if (holidaysError) {
      console.error('OfficerTakenGate: holidays fetch failed', holidaysError);
    }
    const isHoliday = (holidaysData || []).some((h) => normalizeHolidayDate(h) === d);
    const nonWorkingDay = isSundayEAT() || isHoliday;

    if (nonWorkingDay) {
      const ackKey = `${NO_WORK_ACK_PREFIX}${d}`;
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ackKey)) {
        setResolved(true);
        setNeedsGate(false);
        setShowNoWorkModal(false);
        setPrefilledRow(null);
        return;
      }
      setResolved(true);
      setNeedsGate(false);
      setShowNoWorkModal(true);
      setPrefilledRow(null);
      return;
    }

    setShowNoWorkModal(false);
    const { data, error } = await supabase
      .from('officer_field_taken')
      .select('id, amount_taken, prefilled_at, confirmed_at')
      .eq('officer_id', user.id)
      .eq('business_date', d)
      .maybeSingle();

    if (error) {
      console.error(error);
      toast({ title: 'Could not verify float', description: error.message, variant: 'destructive' });
      setResolved(true);
      setNeedsGate(true);
      setPrefilledRow(null);
      return;
    }

    const needsConfirm = !!(data?.prefilled_at && !data?.confirmed_at);
    setPrefilledRow(needsConfirm ? data : null);
    setResolved(true);
    setNeedsGate(!data?.id || needsConfirm);
  }, [user?.id, role, toast]);

  useEffect(() => {
    checkToday();
  }, [checkToday]);

  useEffect(() => {
    if (!needsGate || !user?.id || !todayStr) return;
    let cancelled = false;

    if (prefilledRow) {
      setDepositLoading(false);
      setYesterdayDeposit(null);
      setMode('manual');
      setExtraOnTop('');
      setManualTaken(String(Number(prefilledRow.amount_taken) || 0));
      return undefined;
    }

    setDepositLoading(true);
    setYesterdayDeposit(null);
    setMode('use_deposit');
    setExtraOnTop('');
    setManualTaken('');
    const yesterdayStr = previousCalendarDate(todayStr);
    (async () => {
      const { data, error } = await supabase.rpc('officer_wallet_balance_for_period', {
        p_officer_id: user.id,
        p_from: yesterdayStr,
        p_to: yesterdayStr,
      });
      if (cancelled) return;
      setDepositLoading(false);
      if (error) {
        console.error('officer_wallet_balance_for_period', error);
        setYesterdayDeposit(0);
        setMode('manual');
        return;
      }
      const n = Number(data);
      const dep = Number.isNaN(n) ? 0 : n;
      setYesterdayDeposit(dep);
      setMode(dep > 0 ? 'use_deposit' : 'manual');
    })();
    return () => {
      cancelled = true;
    };
  }, [needsGate, todayStr, user?.id, prefilledRow]);

  const totalTakenToday = useMemo(() => {
    if (prefilledRow) {
      return parseAmountInput(manualTaken);
    }
    if (depositLoading || yesterdayDeposit === null) return null;
    if (yesterdayDeposit > 0) {
      if (mode === 'use_deposit') return yesterdayDeposit;
      if (mode === 'add_on') return yesterdayDeposit + parseAmountInput(extraOnTop);
      return NaN;
    }
    return parseAmountInput(manualTaken);
  }, [prefilledRow, depositLoading, yesterdayDeposit, mode, extraOnTop, manualTaken]);

  const handleSave = async () => {
    if (totalTakenToday === null || Number.isNaN(totalTakenToday) || totalTakenToday < 0) {
      toast({ title: 'Invalid amount', description: 'Enter valid numbers. Zero is allowed.', variant: 'destructive' });
      return;
    }
    if (!user?.id || !todayStr) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase.from('officer_field_taken').upsert(
        {
          officer_id: user.id,
          business_date: todayStr,
          amount_taken: totalTakenToday,
          confirmed_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'officer_id,business_date' }
      );
      if (error) throw error;
      setNeedsGate(false);
      setPrefilledRow(null);
      window.dispatchEvent(new CustomEvent('officer-field-taken-updated'));
      toast({
        title: 'Saved',
        description: prefilledRow ? "Today's planned float confirmed." : "Today's float recorded.",
      });
    } catch (e) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleNoWorkOk = () => {
    if (todayStr && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`${NO_WORK_ACK_PREFIX}${todayStr}`, '1');
    }
    setShowNoWorkModal(false);
  };

  if (role !== 'officer') return null;

  if (!resolved) {
    return (
      <div
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Loading"
      >
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking today&apos;s float…</p>
      </div>
    );
  }

  if (showNoWorkModal) {
    return (
      <div
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background/95 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="officer-no-work-title"
      >
        <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
          <h2 id="officer-no-work-title" className="text-lg font-semibold tracking-tight">
            No work today
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Today ({todayStr}) is a non-working day (Sunday or a public holiday in the system). You do not need to record field float. Tap OK to continue using the app as usual.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
            <Button type="button" onClick={handleNoWorkOk}>
              OK
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!needsGate) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background/95 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="officer-taken-title"
    >
      <div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg max-h-[90dvh] overflow-y-auto">
        <h2 id="officer-taken-title" className="text-lg font-semibold tracking-tight">
          Today&apos;s float (taken)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Business date (Africa/Nairobi): {todayStr}</p>

        {prefilledRow ? (
          <>
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="font-medium text-foreground">Planned from yesterday&apos;s withdraw</p>
              <p className="mt-1 text-muted-foreground">
                You entered this amount when you withdrew to bank. Confirm or edit before you continue.
              </p>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="officer-taken-prefilled">Total taken today</Label>
              <Input
                id="officer-taken-prefilled"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={manualTaken}
                onChange={(e) => setManualTaken(e.target.value)}
                className="text-lg tabular-nums"
              />
            </div>
            <div className="mt-4 rounded-md border border-brand-gold/30 bg-brand-gold/5 px-3 py-2 text-sm">
              <span className="font-medium">Total taken today (saved): </span>
              <span className="tabular-nums font-bold">
                {totalTakenToday !== null && !Number.isNaN(totalTakenToday)
                  ? totalTakenToday.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—'}
              </span>
            </div>
          </>
        ) : depositLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading yesterday&apos;s closing deposit…
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">Yesterday&apos;s closing deposit (field wallet): </span>
              <span className="tabular-nums font-semibold">
                {yesterdayDeposit != null ? yesterdayDeposit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">
                This is taken + repayments + fees − disbursements − expenses for yesterday only (same as Field wallet for that day).
              </p>
            </div>

            {yesterdayDeposit != null && yesterdayDeposit > 0 && (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium text-foreground">How do you want to set today&apos;s taken?</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant={mode === 'use_deposit' ? 'default' : 'outline'}
                    className="flex-1 h-auto py-2 whitespace-normal text-left"
                    onClick={() => setMode('use_deposit')}
                  >
                    Use yesterday&apos;s deposit only
                  </Button>
                  <Button
                    type="button"
                    variant={mode === 'add_on' ? 'default' : 'outline'}
                    className="flex-1 h-auto py-2 whitespace-normal text-left"
                    onClick={() => setMode('add_on')}
                  >
                    Add office cash on top of yesterday&apos;s deposit
                  </Button>
                </div>
                {mode === 'add_on' && (
                  <div className="space-y-2">
                    <Label htmlFor="officer-taken-extra">Additional amount from office (on top of yesterday&apos;s deposit)</Label>
                    <Input
                      id="officer-taken-extra"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={extraOnTop}
                      onChange={(e) => setExtraOnTop(e.target.value)}
                      className="tabular-nums"
                    />
                  </div>
                )}
              </div>
            )}

            {yesterdayDeposit != null && yesterdayDeposit <= 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  There was no closing deposit yesterday (or it was zero). Enter today&apos;s total taken from the office, or <strong>0</strong> if you have no float.
                </p>
                <Label htmlFor="officer-taken-manual">Total taken today</Label>
                <Input
                  id="officer-taken-manual"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={manualTaken}
                  onChange={(e) => setManualTaken(e.target.value)}
                  className="text-lg tabular-nums"
                />
              </div>
            )}

            <div className="mt-4 rounded-md border border-brand-gold/30 bg-brand-gold/5 px-3 py-2 text-sm">
              <span className="font-medium">Total taken today (saved): </span>
              <span className="tabular-nums font-bold">
                {totalTakenToday !== null && !Number.isNaN(totalTakenToday)
                  ? totalTakenToday.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—'}
              </span>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Loan disbursements for today require enough field wallet cash for that day (taken + collections + fees − expenses − disbursements). You can still save <strong>0</strong> taken and later collect repayments before disbursing.
            </p>
          </>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => signOut()} disabled={saving || depositLoading}>
            Sign out
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || depositLoading || totalTakenToday === null || Number.isNaN(totalTakenToday)}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {prefilledRow ? 'Confirm and continue' : 'Save and continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default OfficerTakenGate;

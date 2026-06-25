import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { FieldWalletTraceGrid } from '@/components/admin/FieldWalletTraceGrid';
import { FieldWalletTraceSummaryTable } from '@/components/admin/FieldWalletTraceSummaryTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadFieldWalletTraceSample } from '@/lib/loadFieldWalletTraceSample';
import { FIELD_WALLET_TRACE_SAMPLE } from '@/lib/fieldWalletTraceSampleData';

/** Dummy-data field wallet trace grid (no API). */
export function FieldWalletTraceSampleContent({ showLoginHint = false }) {
  const sample = useMemo(() => loadFieldWalletTraceSample(), []);
  const { currency, blocks, withdrawByOfficer } = sample;
  const walletDate = FIELD_WALLET_TRACE_SAMPLE.walletDate;

  const formatMoney = useMemo(
    () => (n) =>
      `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency]
  );

  const totalNet = blocks.reduce((s, b) => s + (Number(b.totals.deposit) || 0), 0);
  const withdrawnCount = blocks.filter((b) => withdrawByOfficer.has(b.officer.id)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/80 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
          <FlaskConical className="h-3.5 w-3.5" />
          DUMMY DATA — hakuna Supabase
        </span>
        {showLoginHint ? (
          <Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
            Sign in for live trace
          </Link>
        ) : null}
      </div>

      <Card className="border-sky-200/80 dark:border-sky-900/50">
        <CardHeader>
          <CardTitle className="text-base">Mfano: Juma + Asha</CardTitle>
          <CardDescription>
            Juma: closing 1M, next day taken 2M → Office Topup 1M, bank 0. Asha: pending withdraw.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sum — net deposit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatMoney(totalNet)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Day: {walletDate}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Withdrawn</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              {withdrawnCount} / {blocks.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total to bank</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatMoney(0)}</p>
          </CardContent>
        </Card>
      </div>

      <FieldWalletTraceGrid blocks={blocks} withdrawByOfficer={withdrawByOfficer} formatMoney={formatMoney} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By officer — summary</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldWalletTraceSummaryTable
            blocks={blocks}
            withdrawByOfficer={withdrawByOfficer}
            formatMoney={formatMoney}
          />
        </CardContent>
      </Card>
    </div>
  );
}

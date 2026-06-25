import React from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { FIELD_WALLET_GRID_HEADERS } from '@/lib/fieldWalletReportColumns';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function fmtMoney(formatMoney, n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return formatMoney(x);
}

function WithdrawMetaCards({ wRow, formatMoney, depositShown, depositSameDay }) {
  const carry = wRow ? Number(wRow.carried_to_next_day) || 0 : 0;
  const topUp = wRow ? Number(wRow.top_up_from_office) || 0 : 0;
  const planned =
    wRow && Number(wRow.planned_next_day_taken) > 0 ? Number(wRow.planned_next_day_taken) : carry;
  const bank = wRow && wRow.amount_deposited != null ? Number(wRow.amount_deposited) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deposit (in hand)</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{fmtMoney(formatMoney, depositShown)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Same day: {fmtMoney(formatMoney, depositSameDay)}
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Carry forward</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{carry > 0 ? fmtMoney(formatMoney, carry) : '—'}</p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Office Topup</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{topUp > 0 ? fmtMoney(formatMoney, topUp) : '—'}</p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next day taken · To bank</p>
          <p className="mt-1 text-xl font-bold tabular-nums">
            {planned > 0 ? fmtMoney(formatMoney, planned) : '—'}
            {wRow ? ` · ${bank != null ? fmtMoney(formatMoney, bank) : '—'}` : ''}
          </p>
          {wRow?.next_business_date ? (
            <p className="mt-1 text-xs text-muted-foreground">For {wRow.next_business_date}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function OfficerBlock({ block, wRow, formatMoney, pendingWithdraw }) {
  const officerName = block.officer?.full_name || '—';
  const centreRows = block.centerRows?.length ? block.centerRows : [];
  const t = block.totals || {};
  const depositSameDay = Number(t.rawDeposit ?? t.deposit) || 0;
  const depositShown = Number(t.deposit) || 0;
  const totalRowSpan = Math.max(centreRows.length, 1) + 1;

  const thClass =
    'border border-border bg-muted/80 px-1 py-2 text-left text-[0.62rem] sm:text-[0.65rem] font-semibold uppercase leading-tight break-words whitespace-normal';
  const tdClass = 'border border-border px-1 py-2 text-[0.68rem] sm:text-xs tabular-nums break-words';
  const totalClass = cn(tdClass, 'bg-amber-100/90 font-semibold dark:bg-amber-950/50');
  const officerCellClass = cn(
    tdClass,
    'bg-foreground text-background font-bold text-left align-middle min-w-[4rem] max-w-[8rem] px-1.5 py-2 text-[0.68rem] sm:text-xs leading-snug'
  );

  return (
    <div className={cn('space-y-3', pendingWithdraw && 'rounded-lg ring-2 ring-amber-400/60 ring-offset-2 ring-offset-background')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{officerName}</h3>
        {wRow ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Withdrawn
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-200">
            <CircleDashed className="h-3.5 w-3.5" />
            Pending withdraw
          </span>
        )}
      </div>

      <div className="rounded-md border border-border">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[8%]" />
            <col className="w-[5.5%]" />
            <col className="w-[7%]" />
            <col span={11} />
          </colgroup>
          <thead>
            <tr>
              {FIELD_WALLET_GRID_HEADERS.map((h) => (
                <th key={h} className={thClass}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {centreRows.length === 0 ? (
              <tr>
                <td rowSpan={2} className={officerCellClass}>
                  {officerName}
                </td>
                <td className={tdClass} colSpan={13}>
                  — No centre rows —
                </td>
              </tr>
            ) : (
              centreRows.map((cr, i) => (
                <tr key={cr.centerId ?? cr.centerName ?? i}>
                  {i === 0 ? (
                    <td rowSpan={totalRowSpan} className={officerCellClass}>
                      {officerName}
                    </td>
                  ) : null}
                  <td className={tdClass} />
                  <td className={cn(tdClass, 'font-medium')}>{cr.centerName}</td>
                  <td className={cn(tdClass, 'text-right')}>{fmtMoney(formatMoney, cr.disbursement)}</td>
                  <td className={cn(tdClass, 'text-center')}>{cr.disbursedClients ?? 0}</td>
                  <td className={cn(tdClass, 'text-right')}>{fmtMoney(formatMoney, cr.collectionWithoutPrepayment)}</td>
                  <td className={cn(tdClass, 'text-right')}>{fmtMoney(formatMoney, cr.applicationFee)}</td>
                  <td className={cn(tdClass, 'text-right')}>{fmtMoney(formatMoney, cr.prepayment)}</td>
                  <td className={cn(tdClass, 'text-center')}>{cr.prepaidClients ?? 0}</td>
                  <td className={cn(tdClass, 'text-right')}>{fmtMoney(formatMoney, cr.penalty)}</td>
                  <td className={tdClass} />
                  <td className={tdClass} />
                  <td className={tdClass} />
                </tr>
              ))
            )}

            <tr>
              <td className={totalClass} />
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.amountTaken)}</td>
              <td className={totalClass}>TOTAL</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.disbursement)}</td>
              <td className={cn(totalClass, 'text-center')}>{t.disbursedClients ?? 0}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.collectionWithoutPrepayment)}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.applicationFee)}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.prepayment)}</td>
              <td className={cn(totalClass, 'text-center')}>{t.prepaidClients ?? 0}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.penalty)}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.transport)}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.expense1 ?? t.otherExpenses)}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, t.expense2)}</td>
              <td className={cn(totalClass, 'text-right')}>{fmtMoney(formatMoney, depositSameDay)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <WithdrawMetaCards
        wRow={wRow}
        formatMoney={formatMoney}
        depositShown={depositShown}
        depositSameDay={depositSameDay}
      />
    </div>
  );
}

/**
 * Excel-style field wallet grid (officer × centre) with withdraw meta cards.
 */
export function FieldWalletTraceGrid({ blocks, withdrawByOfficer, formatMoney }) {
  if (!blocks?.length) {
    return <p className="text-sm text-muted-foreground">No officers in scope.</p>;
  }

  return (
    <div className="space-y-10">
      {blocks.map((block) => {
        const oid = block.officer?.id;
        const wRow = withdrawByOfficer?.get?.(oid) ?? withdrawByOfficer?.[oid] ?? null;
        return (
          <OfficerBlock
            key={oid ?? block.officer?.full_name}
            block={block}
            wRow={wRow}
            formatMoney={formatMoney}
            pendingWithdraw={!wRow}
          />
        );
      })}
    </div>
  );
}

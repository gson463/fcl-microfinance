import React from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { FIELD_WALLET_GRID_HEADERS } from '@/lib/fieldWalletReportColumns';
import { TraceMoney } from '@/components/admin/TraceMoney';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
          <div className="mt-1">
            <TraceMoney value={depositShown} formatMoney={formatMoney} bold amountClassName="text-base sm:text-lg" />
          </div>
          <p className="mt-1 flex flex-wrap items-baseline justify-end gap-x-1 text-xs text-muted-foreground">
            Same day: <TraceMoney value={depositSameDay} formatMoney={formatMoney} className="!w-auto inline-flex" />
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Carry forward</p>
          <div className="mt-1">
            {carry > 0 ? (
              <TraceMoney value={carry} formatMoney={formatMoney} bold amountClassName="text-base sm:text-lg" />
            ) : (
              <span className="text-lg font-bold">—</span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Office Topup</p>
          <div className="mt-1">
            {topUp > 0 ? (
              <TraceMoney value={topUp} formatMoney={formatMoney} bold amountClassName="text-base sm:text-lg" />
            ) : (
              <span className="text-lg font-bold">—</span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next day taken · To bank</p>
          <div className="mt-1 flex flex-wrap items-end justify-end gap-x-2 gap-y-1">
            {planned > 0 ? (
              <TraceMoney value={planned} formatMoney={formatMoney} bold amountClassName="text-base sm:text-lg" />
            ) : (
              <span className="text-lg font-bold">—</span>
            )}
            {wRow ? (
              <>
                <span className="text-muted-foreground">·</span>
                <TraceMoney value={bank} formatMoney={formatMoney} bold amountClassName="text-base sm:text-lg" />
              </>
            ) : null}
          </div>
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
    'border border-border bg-muted/80 px-1 py-1.5 text-left text-[0.58rem] sm:text-[0.62rem] font-semibold uppercase leading-tight whitespace-normal';
  const tdClass = 'border border-border px-1 py-1.5 align-middle text-[0.65rem] sm:text-xs';
  const tdNumClass = cn(tdClass, 'text-right');
  const totalClass = cn(tdClass, 'bg-amber-100/90 font-semibold dark:bg-amber-950/50');
  const officerCellClass = cn(
    tdClass,
    'bg-foreground text-background font-bold text-left break-words leading-snug'
  );

  const numCell = (value) => (
    <td className={tdNumClass}>
      <TraceMoney value={value} formatMoney={formatMoney} />
    </td>
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

      <div className="-mx-1 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[880px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[7%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[8%]" />
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
                  <td className={cn(tdClass, 'break-words font-medium')}>{cr.centerName}</td>
                  {numCell(cr.disbursement)}
                  <td className={cn(tdClass, 'text-center tabular-nums')}>{cr.disbursedClients ?? 0}</td>
                  {numCell(cr.collectionWithoutPrepayment)}
                  {numCell(cr.applicationFee)}
                  {numCell(cr.prepayment)}
                  <td className={cn(tdClass, 'text-center tabular-nums')}>{cr.prepaidClients ?? 0}</td>
                  {numCell(cr.penalty)}
                  <td className={tdClass} />
                  <td className={tdClass} />
                  <td className={tdClass} />
                </tr>
              ))
            )}

            <tr>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.amountTaken} formatMoney={formatMoney} bold />
              </td>
              <td className={totalClass}>TOTAL</td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.disbursement} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-center tabular-nums')}>{t.disbursedClients ?? 0}</td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.collectionWithoutPrepayment} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.applicationFee} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.prepayment} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-center tabular-nums')}>{t.prepaidClients ?? 0}</td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.penalty} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.transport} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.expense1 ?? t.otherExpenses} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={t.expense2} formatMoney={formatMoney} bold />
              </td>
              <td className={cn(totalClass, 'text-right')}>
                <TraceMoney value={depositSameDay} formatMoney={formatMoney} bold />
              </td>
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

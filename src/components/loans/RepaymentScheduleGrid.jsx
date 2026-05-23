import React, { useState } from 'react';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { FileSpreadsheet, FileDown, Printer, Loader2 } from 'lucide-react';
import {
  exportRepaymentScheduleExcel,
  exportRepaymentSchedulePdf,
  printRepaymentSchedule,
} from '@/lib/scheduleExport';
import { installmentPrincipalInterestPaidDisplay } from '@/lib/installmentScheduleDisplay';

const EAT_TIMEZONE = 'Africa/Nairobi';

function fmtMoney(currency, n) {
  const v = Number(n) || 0;
  return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  try {
    return formatTZ(toZonedTime(new Date(iso), EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
  } catch {
    return '—';
  }
}

/**
 * Spreadsheet-style repayment schedule (Excel-like grid) + optional PDF / Excel export / print with branded header.
 *
 * @param {object} [exportMeta] — when set, shows export toolbar. Should include currency, variant, loan, borrower; schedule is taken from `schedule` prop.
 */
export function RepaymentScheduleGrid({
  schedule,
  currency = 'TZS',
  variant = 'full',
  className,
  maxHeightClass = 'max-h-[60vh]',
  statusBadgeFn,
  emptyMessage = 'No schedule rows.',
  exportMeta,
}) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const rows = Array.isArray(schedule) ? schedule : [];
  const breakdownLoanTotals = exportMeta?.loan ?? null;

  const defaultBadge = (inst) => {
    const v =
      inst.status === 'paid' ? 'success' : inst.status === 'arrears' ? 'warning' : inst.status === 'delinquent' ? 'warning' : 'secondary';
    return <Badge variant={v}>{inst.status}</Badge>;
  };

  const cell = 'border border-[#c6c6c6] px-2 py-1.5 align-middle tabular-nums text-[13px] leading-snug';
  const headCell =
    'border border-[#a8a8a8] bg-[#e4e4e4] px-2 py-2 text-left text-xs font-semibold text-[#222] shadow-sm';

  const runExport = async (fn, successTitle) => {
    if (!exportMeta) return;
    setExporting(true);
    try {
      await fn({
        ...exportMeta,
        schedule: exportMeta.schedule ?? schedule,
        currency: exportMeta.currency ?? currency,
        variant: exportMeta.variant ?? variant,
      });
      toast({ title: successTitle, description: 'Open the downloaded file or the print dialog.' });
    } catch (e) {
      toast({ title: 'Action failed', description: e?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      {exportMeta && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-gold/25 bg-gradient-to-r from-brand-gold/5 to-transparent px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-gold-deep dark:text-brand-gold">
            Export / Print
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting || rows.length === 0}
            onClick={() => runExport(exportRepaymentScheduleExcel, 'Excel')}
          >
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting || rows.length === 0}
            onClick={() => runExport(exportRepaymentSchedulePdf, 'PDF')}
          >
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting || rows.length === 0}
            onClick={() => runExport(printRepaymentSchedule, 'Print')}
          >
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Print
          </Button>
        </div>
      )}

      <div
        className={cn(
          'overflow-auto rounded-sm border border-[#9ca3af] bg-[#fafafa] shadow-[inset_0_1px_0_#fff]',
          maxHeightClass,
          className
        )}
      >
        <table className="w-full min-w-[640px] border-collapse">
          <thead className="sticky top-0 z-10">
            {variant === 'full' ? (
              <tr>
                <th className={cn(headCell, 'w-10 text-center')}>#</th>
                <th className={headCell}>Due date</th>
                <th className={cn(headCell, 'text-right')}>Amount due</th>
                <th className={cn(headCell, 'text-right')}>Principal paid</th>
                <th className={cn(headCell, 'text-right')}>Interest paid</th>
                <th className={cn(headCell, 'text-right')}>Total paid</th>
                <th className={headCell}>Status</th>
              </tr>
            ) : (
              <tr>
                <th className={cn(headCell, 'w-10 text-center')}>#</th>
                <th className={headCell}>Due date</th>
                <th className={cn(headCell, 'text-right')}>Amount due</th>
                <th className={cn(headCell, 'text-right')}>Paid</th>
                <th className={headCell}>Status</th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={variant === 'full' ? 7 : 5}
                  className={cn(cell, 'bg-white text-center text-muted-foreground')}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((inst, idx) => {
                const { principalPaid: rowPrincipalPaid, interestPaid: rowInterestPaid } =
                  installmentPrincipalInterestPaidDisplay(inst, breakdownLoanTotals);
                return (
                <tr
                  key={inst.installmentNumber ?? idx}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-[#f0f4f8]'}
                >
                  <td className={cn(cell, 'text-center font-medium text-[#374151]')}>{inst.installmentNumber}</td>
                  <td className={cn(cell, 'font-mono text-[12px] text-[#111]')}>{fmtDate(inst.dueDate)}</td>
                  <td className={cn(cell, 'text-right')}>{fmtMoney(currency, inst.amount)}</td>
                  {variant === 'full' ? (
                    <>
                      <td className={cn(cell, 'text-right')}>{fmtMoney(currency, rowPrincipalPaid)}</td>
                      <td className={cn(cell, 'text-right')}>{fmtMoney(currency, rowInterestPaid)}</td>
                      <td className={cn(cell, 'text-right font-medium')}>
                        {fmtMoney(currency, inst.paidAmount ?? inst.paid_amount ?? 0)}
                      </td>
                      <td className={cell}>{statusBadgeFn ? statusBadgeFn(inst) : defaultBadge(inst)}</td>
                    </>
                  ) : (
                    <>
                      <td className={cn(cell, 'text-right font-medium')}>
                        {fmtMoney(currency, inst.paidAmount ?? inst.paid_amount ?? 0)}
                      </td>
                      <td className={cell}>{statusBadgeFn ? statusBadgeFn(inst) : defaultBadge(inst)}</td>
                    </>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RepaymentScheduleGrid;

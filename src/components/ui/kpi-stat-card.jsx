import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Responsive figure text that stays inside narrow KPI cards. */
export function KpiValue({ children, className, title }) {
    const tooltip =
        title ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined);
    return (
        <div
            className={cn(
                'min-w-0 w-full overflow-hidden font-bold tabular-nums leading-tight tracking-tight',
                'text-sm sm:text-base md:text-lg xl:text-xl 2xl:text-2xl',
                '[overflow-wrap:anywhere]',
                className,
            )}
            title={tooltip}
        >
            {children}
        </div>
    );
}

export function KpiMoneyValue({
    currency,
    amount,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    className,
}) {
    const num = Number(amount ?? 0);
    const formatted = Number.isFinite(num)
        ? num.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits })
        : '0';
    const full = `${currency} ${formatted}`;
    return (
        <div className={cn('min-w-0', className)} title={full}>
            <span className="block text-xs font-medium text-muted-foreground">{currency}</span>
            <KpiValue title={full}>{formatted}</KpiValue>
        </div>
    );
}

export function KpiStatCard({ title, value, subtitle, icon: Icon, iconClassName, children }) {
    const body = children ?? value;
    return (
        <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="min-w-0 flex-1 text-sm font-medium line-clamp-2">{title}</CardTitle>
                {Icon ? (
                    <Icon className={cn('ml-2 h-4 w-4 shrink-0 text-muted-foreground', iconClassName)} />
                ) : null}
            </CardHeader>
            <CardContent className="min-w-0">
                {typeof body === 'string' || typeof body === 'number' ? (
                    <KpiValue>{body}</KpiValue>
                ) : (
                    body
                )}
                {subtitle ? (
                    <p className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-2">{subtitle}</p>
                ) : null}
            </CardContent>
        </Card>
    );
}

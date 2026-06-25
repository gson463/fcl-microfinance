import { cn } from '@/lib/utils';

/** Split "TZS 1,000,000.00" — returns amount only for trace table cells. */
export function parseFormattedMoney(formatted) {
	const text = String(formatted ?? '').trim();
	const space = text.indexOf(' ');
	if (space > 0) {
		return { currency: text.slice(0, space), amount: text.slice(space + 1) };
	}
	return { currency: '', amount: text };
}

/** Amount only (no currency) — currency belongs in column headers / card labels. */
export function formatTraceAmount(value, formatMoney) {
	const { amount } = parseFormattedMoney(formatMoney(value));
	return amount || '—';
}

/**
 * Money cell for trace tables — numeric value only; TZS shown in headers and labels.
 */
export function TraceMoney({ value, formatMoney, className, amountClassName, bold = false }) {
	return (
		<span
			className={cn(
				'inline-block w-full whitespace-nowrap text-right tabular-nums text-[0.68rem] sm:text-xs',
				bold && 'font-semibold',
				amountClassName,
				className
			)}
		>
			{formatTraceAmount(value, formatMoney)}
		</span>
	);
}

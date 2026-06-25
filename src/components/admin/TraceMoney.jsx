import { cn } from '@/lib/utils';

/** Split "TZS 1,000,000.00" for stacked display in tight table cells. */
export function parseFormattedMoney(formatted) {
	const text = String(formatted ?? '').trim();
	const space = text.indexOf(' ');
	if (space > 0) {
		return { currency: text.slice(0, space), amount: text.slice(space + 1) };
	}
	return { currency: '', amount: text };
}

/**
 * Money cell for trace tables — currency line + amount line, columns stay aligned.
 */
export function TraceMoney({ value, formatMoney, className, amountClassName, bold = false }) {
	const { currency, amount } = parseFormattedMoney(formatMoney(value));

	return (
		<span className={cn('inline-flex w-full flex-col items-end leading-tight', className)}>
			{currency ? (
				<span className="text-[0.58rem] sm:text-[0.62rem] leading-none text-muted-foreground">{currency}</span>
			) : null}
			<span
				className={cn(
					'whitespace-nowrap tabular-nums text-[0.68rem] sm:text-xs',
					bold && 'font-semibold',
					amountClassName
				)}
			>
				{amount || '—'}
			</span>
		</span>
	);
}

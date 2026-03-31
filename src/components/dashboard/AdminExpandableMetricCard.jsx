import React from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Solid-color metric tile: tap header to expand inline sub-rows (deep links to drilldown or routes).
 */
export function AdminExpandableMetricCard({
	cardId,
	expandedId,
	onToggle,
	title,
	value,
	icon: Icon,
	shellClass,
	trackClass,
	fillClass,
	progressPct = 0,
	subItems = [],
	onDrillMetric,
	onNavigatePath,
}) {
	const open = expandedId === cardId;
	const pct = Math.min(100, Math.max(0, Number(progressPct) || 0));

	return (
		<div
			className={cn(
				'relative overflow-hidden rounded-2xl border border-white/20 text-white shadow-lg transition-[box-shadow] duration-200',
				shellClass
			)}
		>
			<button
				type="button"
				onClick={() => onToggle(cardId)}
				className="relative w-full px-4 pb-3 pt-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
			>
				<Icon
					className="pointer-events-none absolute right-3 top-3 h-16 w-16 opacity-[0.18]"
					strokeWidth={1.25}
					aria-hidden
				/>
				<p className="relative pr-14 text-xs font-semibold uppercase tracking-wide text-white/90">{title}</p>
				<p className="relative mt-2 font-display text-xl font-bold tabular-nums leading-tight sm:text-2xl">{value}</p>
				<div className="relative mt-4 flex items-center gap-2 text-[11px] font-semibold text-white/85">
					<span>{open ? 'Hide' : 'Expand'}</span>
					<ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
				</div>
			</button>

			<div className={cn('relative px-4', trackClass || 'bg-black/20')}>
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-black/25">
					<div
						className={cn('h-full rounded-full transition-[width] duration-500', fillClass || 'bg-white/70')}
						style={{ width: `${pct}%` }}
					/>
				</div>
			</div>

			{open && subItems.length > 0 && (
				<div className="space-y-1.5 border-t border-white/15 bg-black/15 px-3 py-3">
					{subItems.map((item) => (
						<button
							key={item.key ?? `${item.label}-${item.metricKey ?? item.path ?? ''}`}
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								if (item.metricKey && onDrillMetric) onDrillMetric(item.metricKey, item.drillParams);
								else if (item.path && onNavigatePath) onNavigatePath(item.path);
							}}
							className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left text-sm font-medium text-white/95 backdrop-blur-sm transition hover:bg-white/20"
						>
							<span className="min-w-0 flex-1 truncate">{item.label}</span>
							{item.value != null && (
								<span className="shrink-0 tabular-nums text-xs text-white/85">{item.value}</span>
							)}
							<ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
						</button>
					))}
				</div>
			)}

			<div className="h-2" />
		</div>
	);
}

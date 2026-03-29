import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const defaultDashboardRange = () => ({
	from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
	to: new Date(),
});

/** Top summary row — vivid gradient shells (white text). */
const STAT_CARD_SHELLS = [
	{
		card: 'bg-gradient-to-br from-violet-500 via-fuchsia-600 to-indigo-900 shadow-xl shadow-violet-600/40 ring-1 ring-white/25',
		title: 'text-white/90',
		value: 'text-white drop-shadow-md',
	},
	{
		card: 'bg-gradient-to-br from-emerald-400 via-teal-600 to-cyan-900 shadow-xl shadow-emerald-600/40 ring-1 ring-white/25',
		title: 'text-white/90',
		value: 'text-white drop-shadow-md',
	},
	{
		card: 'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-700 shadow-xl shadow-orange-500/40 ring-1 ring-white/25',
		title: 'text-white/90',
		value: 'text-white drop-shadow-md',
	},
	{
		card: 'bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-900 shadow-xl shadow-blue-600/40 ring-1 ring-white/25',
		title: 'text-white/90',
		value: 'text-white drop-shadow-md',
	},
];

export const DashboardStatCard = ({ title, children, index = 0 }) => {
	const shell = STAT_CARD_SHELLS[index % STAT_CARD_SHELLS.length];
	return (
		<Card className={cn('overflow-hidden border-0', shell.card)}>
			<CardHeader className="pb-2">
				<CardTitle className={cn('text-sm font-medium', shell.title)}>{title}</CardTitle>
			</CardHeader>
			<CardContent className={cn('text-2xl font-bold tabular-nums', shell.value)}>{children}</CardContent>
		</Card>
	);
};

/** Bold dark gradients + white text (readable, “kali”). */
const METRIC_GRADIENTS = [
	{
		card: 'bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-950 border-white/20 shadow-xl shadow-violet-600/35 hover:shadow-violet-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
	{
		card: 'bg-gradient-to-br from-emerald-500 via-teal-700 to-cyan-950 border-white/20 shadow-xl shadow-emerald-600/35 hover:shadow-emerald-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
	{
		card: 'bg-gradient-to-br from-sky-500 via-blue-700 to-indigo-950 border-white/20 shadow-xl shadow-sky-600/35 hover:shadow-sky-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
	{
		card: 'bg-gradient-to-br from-amber-500 via-orange-600 to-rose-800 border-white/20 shadow-xl shadow-amber-600/35 hover:shadow-amber-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-yellow-100',
	},
	{
		card: 'bg-gradient-to-br from-rose-500 via-pink-600 to-fuchsia-950 border-white/20 shadow-xl shadow-rose-600/35 hover:shadow-rose-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
	{
		card: 'bg-gradient-to-br from-cyan-500 via-teal-700 to-emerald-950 border-white/20 shadow-xl shadow-cyan-600/35 hover:shadow-cyan-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
	{
		card: 'bg-gradient-to-br from-indigo-600 via-violet-700 to-purple-950 border-white/20 shadow-xl shadow-indigo-600/35 hover:shadow-indigo-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
	{
		card: 'bg-gradient-to-br from-fuchsia-600 via-purple-700 to-violet-950 border-white/20 shadow-xl shadow-fuchsia-600/35 hover:shadow-fuchsia-500/45 hover:ring-1 hover:ring-white/30',
		title: 'text-white/80',
		value: 'text-white',
		link: 'text-amber-200',
	},
];

const ACCENT_METRIC = {
	card: 'bg-gradient-to-br from-amber-400 via-yellow-500 to-orange-700 border-amber-200/40 shadow-xl shadow-amber-500/40 text-neutral-950 hover:shadow-amber-400/50 hover:ring-1 hover:ring-amber-100/50',
	title: 'text-neutral-900/90',
	value: 'text-neutral-950',
	link: 'text-amber-950 font-bold',
};

function pickMetricGradient(metricKey, accent) {
	if (accent) return ACCENT_METRIC;
	let h = 0;
	const k = String(metricKey || '');
	for (let i = 0; i < k.length; i++) {
		h = (h + k.charCodeAt(i) * (i + 1)) % 997;
	}
	return METRIC_GRADIENTS[h % METRIC_GRADIENTS.length];
}

export const ClickMetricCard = ({ title, description, value, metricKey, onOpen, accent }) => {
	const g = pickMetricGradient(metricKey, accent);
	return (
		<button
			type="button"
			onClick={() => onOpen(metricKey)}
			className={cn(
				'group relative w-full overflow-hidden rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80',
				g.card
			)}
		>
			<div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15 blur-3xl" />
			<div className="pointer-events-none absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-black/10 blur-2xl" />
			<p className={cn('relative text-xs font-bold uppercase tracking-wide', g.title)}>{title}</p>
			{description && (
				<p
					className={cn(
						'relative mt-1 text-[11px] line-clamp-2',
						accent ? 'text-neutral-900/75' : 'text-white/65'
					)}
				>
					{description}
				</p>
			)}
			<p className={cn('relative mt-3 font-display text-lg font-bold', g.value)}>{value}</p>
			<span className={cn('relative mt-2 inline-block text-xs font-semibold', g.link)}>View details →</span>
		</button>
	);
};

export const MetricSection = ({ icon: Icon, title, subtitle, children }) => (
	<div className="space-y-3">
		<div className="flex items-start gap-3 rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-500/20 via-white to-sky-500/25 px-3 py-3 shadow-lg shadow-amber-900/10 ring-1 ring-white/60">
			<div className="mt-0.5 rounded-xl bg-gradient-to-br from-amber-400 via-brand-gold to-orange-600 p-2.5 text-white shadow-lg shadow-amber-600/40 ring-2 ring-white/30">
				<Icon className="h-5 w-5" />
			</div>
			<div>
				<h2 className="font-display text-lg font-bold tracking-tight text-neutral-900">{title}</h2>
				{subtitle && <p className="text-sm text-neutral-600">{subtitle}</p>}
			</div>
		</div>
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
	</div>
);

/** Quick action tiles — full saturated gradients, light text (see descendant overrides). */
const QUICK_ACTION_GRADIENTS = [
	'border-0 bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-900 text-white shadow-xl shadow-violet-600/35 ring-1 ring-white/20 hover:shadow-violet-500/50 [&_h3]:text-white [&_p]:text-violet-100/90 [&_button]:border-white/35 [&_button]:bg-white/10 [&_button]:text-white [&_button]:hover:bg-white/20',
	'border-0 bg-gradient-to-br from-emerald-500 via-teal-700 to-cyan-900 text-white shadow-xl shadow-emerald-600/35 ring-1 ring-white/20 hover:shadow-emerald-500/50 [&_h3]:text-white [&_p]:text-emerald-100/90 [&_button]:border-white/35 [&_button]:bg-white/10 [&_button]:text-white [&_button]:hover:bg-white/20',
	'border-0 bg-gradient-to-br from-amber-500 via-orange-600 to-rose-800 text-white shadow-xl shadow-orange-500/35 ring-1 ring-white/20 hover:shadow-amber-500/50 [&_h3]:text-white [&_p]:text-amber-100/90 [&_button]:border-white/35 [&_button]:bg-white/10 [&_button]:text-white [&_button]:hover:bg-white/20',
	'border-0 bg-gradient-to-br from-sky-500 via-blue-700 to-indigo-950 text-white shadow-xl shadow-blue-600/35 ring-1 ring-white/20 hover:shadow-sky-500/50 [&_h3]:text-white [&_p]:text-sky-100/90 [&_button]:border-white/35 [&_button]:bg-white/10 [&_button]:text-white [&_button]:hover:bg-white/20',
	'border-0 bg-gradient-to-br from-rose-500 via-pink-600 to-fuchsia-950 text-white shadow-xl shadow-rose-600/35 ring-1 ring-white/20 hover:shadow-rose-500/50 [&_h3]:text-white [&_p]:text-rose-100/90 [&_button]:border-white/35 [&_button]:bg-white/10 [&_button]:text-white [&_button]:hover:bg-white/20',
	'border-0 bg-gradient-to-br from-indigo-600 via-violet-700 to-purple-950 text-white shadow-xl shadow-indigo-600/35 ring-1 ring-white/20 hover:shadow-indigo-500/50 [&_h3]:text-white [&_p]:text-indigo-100/90 [&_button]:border-white/35 [&_button]:bg-white/10 [&_button]:text-white [&_button]:hover:bg-white/20',
];

export const quickActionCardClass = (index) => QUICK_ACTION_GRADIENTS[index % QUICK_ACTION_GRADIENTS.length];

export const quickActionIconWrapClass =
	'mb-3 rounded-xl bg-white/20 p-3 text-white shadow-inner ring-1 ring-white/30 backdrop-blur-sm';

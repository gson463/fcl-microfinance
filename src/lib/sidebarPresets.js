/**
 * Sidebar color presets (Tailwind classes). Persisted per user via localStorage (`fcl-sidebar-accent`).
 */
export const SIDEBAR_PRESET_IDS = ['midnight', 'gold', 'ocean', 'forest', 'wine', 'royal'];

export const sidebarPresets = {
	midnight: {
		id: 'midnight',
		label: 'Midnight',
		swatch: 'from-slate-800 to-slate-950',
		aside:
			'border-r border-white/[0.07] bg-gradient-to-b from-[#0c131d] via-[#0a0f18] to-[#050a12]',
		glow: 'bg-brand-gold/8',
		topHairline: 'bg-gradient-to-r from-transparent via-brand-gold/45 to-transparent',
		header: 'border-brand-gold/20 bg-gradient-to-br from-black/50 to-[#0a1018]',
		navLabel: 'text-brand-gold/55',
		divider: 'bg-gradient-to-r from-transparent via-brand-blue/35 to-transparent opacity-80',
		footerWrap: 'border-brand-gold/15 bg-black/25',
		collapseBtn: 'text-brand-gold/90 hover:text-brand-gold',
		mobileHeader:
			'border-brand-gold/25 bg-gradient-to-r from-[#0a0f18] via-[#0c121c] to-[#0a0f18]',
		mobileTopHairline: 'bg-gradient-to-r from-transparent via-brand-gold/50 to-transparent',
	},
	gold: {
		id: 'gold',
		label: 'Amber',
		swatch: 'from-amber-700 to-amber-950',
		aside:
			'border-r border-amber-950/50 bg-gradient-to-b from-[#1c140a] via-[#120c06] to-[#0a0604]',
		glow: 'bg-amber-500/12',
		topHairline: 'bg-gradient-to-r from-transparent via-amber-400/50 to-transparent',
		header: 'border-amber-700/35 bg-gradient-to-br from-amber-950/60 to-[#0f0a05]',
		navLabel: 'text-amber-400/65',
		divider: 'bg-gradient-to-r from-transparent via-amber-600/35 to-transparent opacity-80',
		footerWrap: 'border-amber-900/30 bg-black/30',
		collapseBtn: 'text-amber-300/95 hover:text-amber-200',
		mobileHeader:
			'border-amber-700/40 bg-gradient-to-r from-[#140e08] via-[#1a1209] to-[#140e08]',
		mobileTopHairline: 'bg-gradient-to-r from-transparent via-amber-500/45 to-transparent',
	},
	ocean: {
		id: 'ocean',
		label: 'Ocean',
		swatch: 'from-cyan-600 to-slate-950',
		aside:
			'border-r border-cyan-950/40 bg-gradient-to-b from-[#0a1620] via-[#061018] to-[#040a10]',
		glow: 'bg-cyan-400/10',
		topHairline: 'bg-gradient-to-r from-transparent via-cyan-400/45 to-transparent',
		header: 'border-cyan-800/30 bg-gradient-to-br from-cyan-950/40 to-[#050c12]',
		navLabel: 'text-cyan-400/65',
		divider: 'bg-gradient-to-r from-transparent via-cyan-500/35 to-transparent opacity-80',
		footerWrap: 'border-cyan-900/35 bg-black/25',
		collapseBtn: 'text-cyan-300/90 hover:text-cyan-200',
		mobileHeader:
			'border-cyan-800/35 bg-gradient-to-r from-[#081218] via-[#0a1820] to-[#081218]',
		mobileTopHairline: 'bg-gradient-to-r from-transparent via-cyan-400/45 to-transparent',
	},
	forest: {
		id: 'forest',
		label: 'Forest',
		swatch: 'from-emerald-600 to-stone-950',
		aside:
			'border-r border-emerald-950/40 bg-gradient-to-b from-[#0a1812] via-[#061210] to-[#040a0c]',
		glow: 'bg-emerald-400/10',
		topHairline: 'bg-gradient-to-r from-transparent via-emerald-400/45 to-transparent',
		header: 'border-emerald-800/30 bg-gradient-to-br from-emerald-950/40 to-[#050f0a]',
		navLabel: 'text-emerald-400/65',
		divider: 'bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-80',
		footerWrap: 'border-emerald-900/35 bg-black/25',
		collapseBtn: 'text-emerald-300/90 hover:text-emerald-200',
		mobileHeader:
			'border-emerald-800/35 bg-gradient-to-r from-[#081410] via-[#0c1a14] to-[#081410]',
		mobileTopHairline: 'bg-gradient-to-r from-transparent via-emerald-400/45 to-transparent',
	},
	wine: {
		id: 'wine',
		label: 'Wine',
		swatch: 'from-rose-700 to-stone-950',
		aside:
			'border-r border-rose-950/35 bg-gradient-to-b from-[#180a12] via-[#10060c] to-[#080408]',
		glow: 'bg-rose-500/10',
		topHairline: 'bg-gradient-to-r from-transparent via-rose-400/45 to-transparent',
		header: 'border-rose-900/30 bg-gradient-to-br from-rose-950/45 to-[#0c0608]',
		navLabel: 'text-rose-400/60',
		divider: 'bg-gradient-to-r from-transparent via-rose-500/30 to-transparent opacity-80',
		footerWrap: 'border-rose-900/35 bg-black/30',
		collapseBtn: 'text-rose-300/90 hover:text-rose-200',
		mobileHeader:
			'border-rose-900/35 bg-gradient-to-r from-[#120810] via-[#160c14] to-[#120810]',
		mobileTopHairline: 'bg-gradient-to-r from-transparent via-rose-400/45 to-transparent',
	},
	royal: {
		id: 'royal',
		label: 'Royal',
		swatch: 'from-indigo-600 to-violet-950',
		aside:
			'border-r border-indigo-950/40 bg-gradient-to-b from-[#0e0a1a] via-[#080618] to-[#040410]',
		glow: 'bg-violet-500/12',
		topHairline: 'bg-gradient-to-r from-transparent via-violet-400/45 to-transparent',
		header: 'border-violet-800/30 bg-gradient-to-br from-indigo-950/50 to-[#0a0818]',
		navLabel: 'text-violet-400/65',
		divider: 'bg-gradient-to-r from-transparent via-violet-500/35 to-transparent opacity-80',
		footerWrap: 'border-violet-900/35 bg-black/25',
		collapseBtn: 'text-violet-300/90 hover:text-violet-200',
		mobileHeader:
			'border-violet-800/35 bg-gradient-to-r from-[#0c0a16] via-[#100e1c] to-[#0c0a16]',
		mobileTopHairline: 'bg-gradient-to-r from-transparent via-violet-400/45 to-transparent',
	},
};

export function getSidebarPreset(id) {
	const p = sidebarPresets[id];
	return p || sidebarPresets.midnight;
}

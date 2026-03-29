import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SIDEBAR_PRESET_IDS } from '@/lib/sidebarPresets';

export const THEME_STORAGE_KEY = 'fcl-theme';
export const SIDEBAR_STORAGE_KEY = 'fcl-sidebar-accent';

/** @typedef {'light' | 'dark' | 'system'} ThemePreference */

const ThemeContext = createContext(null);

function readStoredTheme() {
	try {
		const v = localStorage.getItem(THEME_STORAGE_KEY);
		if (v === 'light' || v === 'dark' || v === 'system') return v;
	} catch {
		/* ignore */
	}
	return 'system';
}

function readStoredSidebarPreset() {
	try {
		const v = localStorage.getItem(SIDEBAR_STORAGE_KEY);
		if (SIDEBAR_PRESET_IDS.includes(v)) return v;
	} catch {
		/* ignore */
	}
	return 'midnight';
}

function systemPrefersDark() {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Effective appearance for UI. */
export function resolveEffectiveTheme(preference) {
	if (preference === 'light') return 'light';
	if (preference === 'dark') return 'dark';
	return systemPrefersDark() ? 'dark' : 'light';
}

function applyClassToDocument(effective) {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', effective === 'dark');
}

export function ThemeProvider({ children }) {
	const [theme, setThemeState] = useState(() => readStoredTheme());
	const [resolvedTheme, setResolvedTheme] = useState(() => resolveEffectiveTheme(readStoredTheme()));
	const [sidebarPreset, setSidebarPresetState] = useState(() => readStoredSidebarPreset());

	const apply = useCallback((preference) => {
		const effective = resolveEffectiveTheme(preference);
		applyClassToDocument(effective);
		setResolvedTheme(effective);
		try {
			localStorage.setItem(THEME_STORAGE_KEY, preference);
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		apply(theme);
	}, [theme, apply]);

	useEffect(() => {
		try {
			localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarPreset);
		} catch {
			/* ignore */
		}
	}, [sidebarPreset]);

	/** OS / browser theme changed while user chose "System" */
	useEffect(() => {
		if (theme !== 'system') return;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => apply('system');
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [theme, apply]);

	/** Other tabs */
	useEffect(() => {
		const onStorage = (e) => {
			if (e.key === THEME_STORAGE_KEY && e.newValue != null) {
				if (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'system') {
					setThemeState(e.newValue);
				}
			}
			if (e.key === SIDEBAR_STORAGE_KEY && e.newValue != null && SIDEBAR_PRESET_IDS.includes(e.newValue)) {
				setSidebarPresetState(e.newValue);
			}
		};
		window.addEventListener('storage', onStorage);
		return () => window.removeEventListener('storage', onStorage);
	}, []);

	const setTheme = useCallback((next) => {
		if (next !== 'light' && next !== 'dark' && next !== 'system') return;
		setThemeState(next);
	}, []);

	const setSidebarPreset = useCallback((next) => {
		if (!SIDEBAR_PRESET_IDS.includes(next)) return;
		setSidebarPresetState(next);
	}, []);

	const value = useMemo(
		() => ({
			theme,
			setTheme,
			/** 'light' | 'dark' — what is actually shown */
			resolvedTheme,
			sidebarPreset,
			setSidebarPreset,
		}),
		[theme, setTheme, resolvedTheme, sidebarPreset, setSidebarPreset]
	);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	const ctx = useContext(ThemeContext);
	if (!ctx) {
		throw new Error('useTheme must be used within ThemeProvider');
	}
	return ctx;
}

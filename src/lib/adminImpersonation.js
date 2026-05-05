/** Single account allowed to start impersonation (canonical lower-case). */
export const SUPER_ADMIN_IMPERSONATION_EMAIL = 'admin@faharicredits.co.tz';

/** sessionStorage: saved admin session tokens before switching user. */
export const IMPERSONATION_ADMIN_BACKUP_KEY = 'fcl_super_admin_impersonation_backup_v1';

export const IMPERSONATION_CHANGE_EVENT = 'fcl-admin-impersonation-change';

export function notifyImpersonationChange() {
	try {
		window.dispatchEvent(new Event(IMPERSONATION_CHANGE_EVENT));
	} catch {
		/* ignore */
	}
}

export function isSuperAdminImpersonator(authUser) {
	const email = typeof authUser?.email === 'string' ? authUser.email.trim().toLowerCase() : '';
	return email === SUPER_ADMIN_IMPERSONATION_EMAIL;
}

export function hasStoredAdminImpersonationBackup() {
	try {
		const raw = sessionStorage.getItem(IMPERSONATION_ADMIN_BACKUP_KEY);
		if (!raw) return false;
		const o = JSON.parse(raw);
		return typeof o?.access_token === 'string' && typeof o?.refresh_token === 'string';
	} catch {
		return false;
	}
}

export function readAdminImpersonationBackup() {
	try {
		const raw = sessionStorage.getItem(IMPERSONATION_ADMIN_BACKUP_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw);
		if (typeof o?.access_token !== 'string' || typeof o?.refresh_token !== 'string') return null;
		return { access_token: o.access_token, refresh_token: o.refresh_token };
	} catch {
		return null;
	}
}

/** Store admin tokens only (no UI event). Call `notifyImpersonationChange` after session switch succeeds. */
export function saveAdminImpersonationBackupSilent(session) {
	if (!session?.access_token || !session?.refresh_token) return;
	try {
		sessionStorage.setItem(
			IMPERSONATION_ADMIN_BACKUP_KEY,
			JSON.stringify({
				access_token: session.access_token,
				refresh_token: session.refresh_token,
			}),
		);
	} catch {
		/* ignore quota / private mode */
	}
}

export function clearAdminImpersonationBackup() {
	try {
		sessionStorage.removeItem(IMPERSONATION_ADMIN_BACKUP_KEY);
		notifyImpersonationChange();
	} catch {
		/* ignore */
	}
}

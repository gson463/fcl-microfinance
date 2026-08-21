/** Must match auditLog.js and supabase/functions/_shared/auditExempt.ts */
export const GPS_EXEMPT_EMAILS = new Set(['admin@faharicredits.co.tz', 'sflaws.g@gmail.com']);

export function isGpsExemptEmail(email) {
	const e = (email ?? '').toLowerCase().trim();
	return Boolean(e && GPS_EXEMPT_EMAILS.has(e));
}

export class SessionLocationRequiredError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SessionLocationRequiredError';
		this.code = code;
	}
}

/** User-facing copy — no "location/GPS" wording. */
export const SESSION_LOCATION_MESSAGES = {
	PERMISSION_DENIED:
		'Ruhusa inahitajika ili kuendelea. Bonyeza Kubali kwenye dirisha la browser.',
	TIMEOUT: 'Hatukuweza kuendelea. Jaribu tena au wasiliana na msimamizi.',
	UNAVAILABLE: 'Hatukuweza kuendelea. Hakikisha muunganisho wa mtandao na ujaribu tena.',
	NOT_SECURE:
		'Mfumo unahitaji uhusiano salama (HTTPS) ili kuendelea. Tumia kiungo cha rasmi cha mfumo.',
	NOT_SUPPORTED: 'Kifaa hiki hakiwezi kuendelea na uelekezaji wa mfumo.',
	NOT_READY: 'Ruhusa inahitajika ili kuendelea. Ingia tena na ukubali uelekezaji.',
};

const SESSION_GPS_STORAGE_KEY = 'fcl_session_gps';

let sessionCache = null;

function isValidLoc(loc) {
	return (
		loc != null &&
		Number.isFinite(Number(loc.latitude)) &&
		Number.isFinite(Number(loc.longitude))
	);
}

function normalizeLoc(raw) {
	if (!isValidLoc(raw)) return null;
	const accuracyM = Number(raw.accuracyM ?? raw.location_accuracy_m);
	return {
		latitude: Number(raw.latitude),
		longitude: Number(raw.longitude),
		accuracyM: Number.isFinite(accuracyM) ? accuracyM : null,
		capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : null,
	};
}

function readStoredSessionLocation() {
	try {
		if (typeof sessionStorage === 'undefined') return null;
		const raw = sessionStorage.getItem(SESSION_GPS_STORAGE_KEY);
		if (!raw) return null;
		return normalizeLoc(JSON.parse(raw));
	} catch {
		return null;
	}
}

function persistSessionLocation(loc) {
	const normalized = normalizeLoc(loc);
	if (!normalized) return null;
	sessionCache = normalized;
	try {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem(SESSION_GPS_STORAGE_KEY, JSON.stringify(normalized));
		}
	} catch {
		/* quota / private mode */
	}
	return normalized;
}

function hydrateSessionCache() {
	if (isValidLoc(sessionCache)) {
		sessionCache = normalizeLoc(sessionCache);
		return sessionCache;
	}
	const stored = readStoredSessionLocation();
	if (stored) {
		sessionCache = stored;
		return sessionCache;
	}
	sessionCache = null;
	return null;
}

hydrateSessionCache();

function mapGeolocationError(err) {
	const code = err?.code;
	if (code === 1) {
		return new SessionLocationRequiredError(
			'PERMISSION_DENIED',
			SESSION_LOCATION_MESSAGES.PERMISSION_DENIED,
		);
	}
	if (code === 2) {
		return new SessionLocationRequiredError(
			'UNAVAILABLE',
			SESSION_LOCATION_MESSAGES.UNAVAILABLE,
		);
	}
	if (code === 3) {
		return new SessionLocationRequiredError('TIMEOUT', SESSION_LOCATION_MESSAGES.TIMEOUT);
	}
	return new SessionLocationRequiredError(
		'UNAVAILABLE',
		SESSION_LOCATION_MESSAGES.UNAVAILABLE,
	);
}

function readPosition(position) {
	const latitude = position?.coords?.latitude;
	const longitude = position?.coords?.longitude;
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
		throw new SessionLocationRequiredError(
			'UNAVAILABLE',
			SESSION_LOCATION_MESSAGES.UNAVAILABLE,
		);
	}
	return {
		latitude,
		longitude,
		accuracyM: Number.isFinite(position?.coords?.accuracy)
			? position.coords.accuracy
			: null,
		capturedAt: new Date().toISOString(),
	};
}

/**
 * Capture device coordinates once (login). Stores in-memory + sessionStorage cache.
 */
export function captureSessionLocation() {
	if (typeof window === 'undefined' || !navigator?.geolocation) {
		return Promise.reject(
			new SessionLocationRequiredError(
				'NOT_SUPPORTED',
				SESSION_LOCATION_MESSAGES.NOT_SUPPORTED,
			),
		);
	}
	if (!window.isSecureContext) {
		return Promise.reject(
			new SessionLocationRequiredError('NOT_SECURE', SESSION_LOCATION_MESSAGES.NOT_SECURE),
		);
	}

	return new Promise((resolve, reject) => {
		navigator.geolocation.getCurrentPosition(
			(position) => {
				try {
					const loc = persistSessionLocation(readPosition(position));
					if (!loc) {
						reject(
							new SessionLocationRequiredError(
								'UNAVAILABLE',
								SESSION_LOCATION_MESSAGES.UNAVAILABLE,
							),
						);
						return;
					}
					resolve(loc);
				} catch (e) {
					reject(e);
				}
			},
			(err) => reject(mapGeolocationError(err)),
			{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
		);
	});
}

export function getSessionLocation() {
	if (!hydrateSessionCache()) {
		throw new SessionLocationRequiredError('NOT_READY', SESSION_LOCATION_MESSAGES.NOT_READY);
	}
	return { ...sessionCache };
}

export function isSessionLocationReady() {
	return hydrateSessionCache() != null;
}

export function clearSessionLocation() {
	sessionCache = null;
	try {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.removeItem(SESSION_GPS_STORAGE_KEY);
		}
	} catch {
		/* ignore */
	}
}

/** For audit payloads / edge functions. Always explicit finite numbers. */
export function sessionLocationPayload(loc = null) {
	const source = normalizeLoc(loc) ?? hydrateSessionCache();
	if (!source) return null;
	return {
		latitude: Number(source.latitude),
		longitude: Number(source.longitude),
		location_accuracy_m: source.accuracyM,
		location_source: 'gps_session',
	};
}

export function formatGpsLabel(latitude, longitude, accuracyM = null) {
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
	const acc =
		accuracyM != null && Number.isFinite(Number(accuracyM))
			? ` (±${Math.round(Number(accuracyM))}m)`
			: '';
	return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}${acc}`;
}

export function googleMapsUrl(latitude, longitude) {
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
	return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

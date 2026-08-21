import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import {
	isGpsExemptEmail,
	getSessionLocation,
	isSessionLocationReady,
	sessionLocationPayload,
	formatGpsLabel,
	SessionLocationRequiredError,
	SESSION_LOCATION_MESSAGES,
} from '@/lib/geolocation';

/** Must match supabase/migrations/*_audit_exempt_emails.sql and functions/_shared/auditExempt.ts */
const AUDIT_EXEMPT_EMAILS = new Set(['admin@faharicredits.co.tz', 'sflaws.g@gmail.com']);

/** Actions that do not require session GPS. */
const SKIP_GEO_ACTIONS = new Set(['auth.logout', 'logout', 'policy.consent.accepted']);

/**
 * Retention: archive or delete audit_logs older than ~6 months via Supabase scheduled job (manual follow-up).
 */

function isAuditExemptSession(session) {
	const e = session?.user?.email?.toLowerCase()?.trim();
	return Boolean(e && AUDIT_EXEMPT_EMAILS.has(e));
}

export { isGpsExemptEmail, SessionLocationRequiredError, SESSION_LOCATION_MESSAGES };

export function shortDeviceSummary(ua) {
	if (!ua) return null;
	let browser = 'Browser';
	if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
	else if (ua.includes('Firefox')) browser = 'Firefox';
	else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
	else if (ua.includes('Edg')) browser = 'Edge';
	let os = 'Unknown';
	if (ua.includes('Windows')) os = 'Windows';
	else if (ua.includes('Mac OS')) os = 'macOS';
	else if (ua.includes('Linux')) os = 'Linux';
	else if (ua.includes('Android')) os = 'Android';
	else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
	return `${browser} / ${os}`;
}

function resolveLocationForAudit({ location, session, action }) {
	if (SKIP_GEO_ACTIONS.has(String(action ?? '').toLowerCase())) {
		return null;
	}
	if (isAuditExemptSession(session)) {
		return null;
	}
	if (location?.latitude != null && location?.longitude != null) {
		return {
			latitude: location.latitude,
			longitude: location.longitude,
			accuracyM: location.accuracyM ?? location.location_accuracy_m ?? null,
			source: location.location_source ?? 'gps_session',
		};
	}
	if (isSessionLocationReady()) {
		const loc = getSessionLocation();
		return {
			latitude: loc.latitude,
			longitude: loc.longitude,
			accuracyM: loc.accuracyM,
			source: 'gps_session',
		};
	}
	return null;
}

async function insertAuditRow(body, sessionToUse) {
	const { error } = await invokeEdgeFunction('log-audit', { body }, sessionToUse.access_token);
	if (!error) return true;

	const gps = body.client_latitude != null
		? {
				latitude: body.client_latitude,
				longitude: body.client_longitude,
				accuracyM: body.client_location_accuracy_m,
				source: body.client_location_source,
			}
		: null;

	const { error: rpcErr } = await supabase.rpc('log_audit_event', {
		p_action: body.action,
		p_entity_type: body.entity_type ?? null,
		p_entity_id: body.entity_id ?? null,
		p_metadata: body.metadata ?? {},
		p_ip_address: body.client_ip ?? null,
		p_user_agent: body.user_agent ?? null,
		p_device_summary: body.device_summary ?? null,
		p_location_label: body.client_location_label ?? null,
		p_latitude: gps?.latitude ?? null,
		p_longitude: gps?.longitude ?? null,
		p_location_accuracy_m: gps?.accuracyM ?? null,
		p_location_source: gps?.source ?? null,
	});
	if (rpcErr) {
		console.warn('[audit]', rpcErr.message);
		return false;
	}
	return true;
}

/**
 * Records one audit row for the current session. Uses session GPS cache (captured at login).
 *
 * @param {{ action, entityType?, entityId?, metadata?, location? }} params
 * @param sessionFromEvent - Optional session from onAuthStateChange
 */
export async function logAudit(
	{ action, entityType, entityId, metadata, location },
	sessionFromEvent = null,
) {
	const { data: { session } } = await supabase.auth.getSession();
	const sessionToUse = sessionFromEvent ?? session;
	if (!sessionToUse?.access_token) return;
	if (isAuditExemptSession(sessionToUse)) return;

	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
	const device = shortDeviceSummary(ua);

	const gps = resolveLocationForAudit({ location, session: sessionToUse, action });

	const locationLabel =
		gps != null ? formatGpsLabel(gps.latitude, gps.longitude, gps.accuracyM) : null;

	const body = {
		action,
		entity_type: entityType ?? null,
		entity_id: entityId != null ? String(entityId) : null,
		metadata: metadata ?? {},
		user_agent: ua,
		device_summary: device,
		client_ip: null,
		client_location_label: locationLabel,
		client_latitude: gps?.latitude ?? null,
		client_longitude: gps?.longitude ?? null,
		client_location_accuracy_m: gps?.accuracyM ?? null,
		client_location_source: gps?.source ?? null,
	};

	try {
		const ok = await insertAuditRow(body, sessionToUse);
		if (!ok && action === 'auth.login') {
			await insertAuditRow(body, sessionToUse);
		}
	} catch (e) {
		console.warn('[audit]', e);
		if (action === 'auth.login') {
			throw e;
		}
	}
}

/** Login-session GPS for request bodies. Null if not captured — callers must not block work. */
export function sessionLocationForRequest() {
	return sessionLocationPayload();
}

/** @deprecated Use sessionLocationForRequest; do not throw on missing GPS during internal work. */
export function requireSessionLocationForRequest() {
	return sessionLocationForRequest();
}

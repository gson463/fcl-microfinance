import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';

/** Must match supabase/migrations/*_audit_exempt_emails.sql and functions/_shared/auditExempt.ts */
const AUDIT_EXEMPT_EMAILS = new Set(['admin@faharicredits.co.tz', 'sflaws.g@gmail.com']);

/** Skip ipapi.co for high-frequency auth events (reduces external HTTP). */
const SKIP_GEO_ACTIONS = new Set(['login', 'logout', 'session_refresh', 'signed_in', 'signed_out', 'auth.login', 'auth.logout']);

/**
 * Retention: archive or delete audit_logs older than ~6 months via Supabase scheduled job (manual follow-up).
 */

function isAuditExemptSession(session) {
	const e = session?.user?.email?.toLowerCase()?.trim();
	return Boolean(e && AUDIT_EXEMPT_EMAILS.has(e));
}

function shortDeviceSummary(ua) {
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

/**
 * Client-side context (IP + rough location from ipapi.co). Best-effort; may fail on ad blockers.
 */
async function fetchClientNetworkContext() {
	try {
		const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
		const j = await r.json();
		if (j.error) return { ip: null, locationLabel: null };
		const parts = [j.city, j.region, j.country_name].filter(Boolean);
		return {
			ip: j.ip ?? null,
			locationLabel: parts.length ? parts.join(', ') : null,
		};
	} catch {
		return { ip: null, locationLabel: null };
	}
}

/**
 * Records one audit row for the current session. Prefers Edge Function (server IP when behind Supabase proxy);
 * falls back to RPC with browser-estimated IP/geo.
 *
 * @param sessionFromEvent - Optional session from `onAuthStateChange` (e.g. SIGNED_IN) so the Edge gateway gets a user JWT before `getSession()` persists (avoids anon-key Bearer → 401).
 */
export async function logAudit({ action, entityType, entityId, metadata }, sessionFromEvent = null) {
	const { data: { session } } = await supabase.auth.getSession();
	const sessionToUse = sessionFromEvent ?? session;
	if (!sessionToUse?.access_token) return;
	if (isAuditExemptSession(sessionToUse)) return;

	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
	const device = shortDeviceSummary(ua);
	const skipGeo = SKIP_GEO_ACTIONS.has(String(action ?? '').toLowerCase());
	const net = skipGeo ? { ip: null, locationLabel: null } : await fetchClientNetworkContext();

	const body = {
		action,
		entity_type: entityType ?? null,
		entity_id: entityId ?? null,
		metadata: metadata ?? {},
		user_agent: ua,
		device_summary: device,
		client_ip: net.ip,
		client_location_label: net.locationLabel,
	};

	try {
		const { error } = await invokeEdgeFunction('log-audit', { body }, sessionToUse.access_token);
		if (!error) return;
	} catch {
		/* fall through to RPC */
	}

	try {
		const { error: rpcErr } = await supabase.rpc('log_audit_event', {
			p_action: action,
			p_entity_type: entityType ?? null,
			p_entity_id: entityId != null ? String(entityId) : null,
			p_metadata: metadata ?? {},
			p_ip_address: net.ip,
			p_user_agent: ua,
			p_device_summary: device,
			p_location_label: net.locationLabel,
		});
		if (rpcErr) console.warn('[audit]', rpcErr.message);
	} catch (e) {
		console.warn('[audit]', e);
	}
}

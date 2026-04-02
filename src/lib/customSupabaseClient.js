import { createClient } from '@supabase/supabase-js';

/**
 * Point to any Supabase project via .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
 * The other project must expose the same tables, RPCs, RLS, Storage buckets (logos, profile-photos), and Edge Functions this app expects.
 */
const supabaseUrl =
	import.meta.env.VITE_SUPABASE_URL || 'https://jdwgpfyaygirkqyywvvj.supabase.co';
const supabaseAnonKey =
	import.meta.env.VITE_SUPABASE_ANON_KEY ||
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impkd2dwZnlheWdpcmtxeXl3dnZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1OTA5OTQsImV4cCI6MjA3NzE2Njk5NH0.9Gesydov6DMN4Cp44-0MW6s2pRyBSl0xi1XvuUV6a8w';

if (!supabaseUrl || !supabaseAnonKey) {
	console.error(
		'[Supabase] Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example).',
	);
}

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Parse JSON body from a FunctionsHttpError (context is a Response, not a string body).
 */
async function errorBodyFromFunctionsHttpError(error) {
	if (error?.name !== 'FunctionsHttpError' || !(error.context instanceof Response)) {
		return null;
	}
	const ct = error.context.headers.get('Content-Type') || '';
	if (!ct.includes('application/json')) {
		return null;
	}
	try {
		return await error.context.clone().json();
	} catch {
		return null;
	}
}

function messageFromFunctionsErrorBody(parsed) {
	if (!parsed || typeof parsed !== 'object') {
		return null;
	}
	if (parsed.error != null) {
		return String(parsed.error);
	}
	// Gateway often returns { code: 401, message: "Invalid JWT" }
	if (parsed.message != null) {
		return String(parsed.message);
	}
	return null;
}

function projectRefFromSupabaseUrl(url) {
	try {
		const m = new URL(url).hostname.match(/^([^.]+)\.supabase\.co$/i);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

/** Decode JWT payload (no signature verify) — for project mismatch hints only. */
function jwtPayload(token) {
	try {
		const parts = String(token).split('.');
		if (parts.length < 2) {
			return null;
		}
		let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
		return JSON.parse(atob(b64 + pad));
	} catch {
		return null;
	}
}

/**
 * User access_token must be minted for this Supabase project (iss contains project ref).
 */
function accessTokenBelongsToClient(accessToken) {
	const ref = projectRefFromSupabaseUrl(supabaseUrl);
	if (!ref || !accessToken) {
		return true;
	}
	const p = jwtPayload(accessToken);
	if (!p) {
		return true;
	}
	const iss = String(p.iss || '');
	return iss.includes(ref);
}

/** Anon key is a JWT; gateway accepts it when the function has verify_jwt disabled. */
function isInvalidJwtMessage(msg) {
	return /invalid jwt/i.test(String(msg || ''));
}

/**
 * Resolve a usable access token: refresh if missing expiry or expiring soon (avoids gateway 401).
 */
async function resolveAccessToken(fallbackAccessToken) {
	const {
		data: { session },
	} = await customSupabaseClient.auth.getSession();
	let token = session?.access_token ?? fallbackAccessToken ?? null;
	if (!token) {
		return null;
	}
	const expSec = session?.expires_at;
	const expiresSoon =
		expSec != null && expSec * 1000 < Date.now() + 120_000;
	if (expiresSoon) {
		const { data: ref, error: refErr } = await customSupabaseClient.auth.refreshSession();
		if (!refErr && ref?.session?.access_token) {
			return ref.session.access_token;
		}
	}
	return token;
}

/**
 * Invoke a Supabase Edge Function with the user's access token (preferred).
 * If the gateway returns 401 Invalid JWT, retries once with the anon key JWT (valid for this
 * project; works when the function has verify_jwt disabled).
 *
 * On non-2xx JSON responses, maps `{ error }` / `{ message }` into `error.message`.
 */
async function parseFunctionsInvokeError(err) {
	const status =
		err?.name === 'FunctionsHttpError' && err.context instanceof Response
			? err.context.status
			: undefined;
	const parsed = await errorBodyFromFunctionsHttpError(err);
	const msg =
		messageFromFunctionsErrorBody(parsed) ||
		(err instanceof Error ? err.message : String(err));
	return { status, parsed, msg };
}

export async function invokeEdgeFunction(name, options = {}, accessToken) {
	let token = await resolveAccessToken(accessToken);
	if (!token) {
		return {
			data: null,
			error: Object.assign(new Error('Not authenticated'), { context: null }),
		};
	}

	if (!accessTokenBelongsToClient(token)) {
		return {
			data: null,
			error: new Error(
				'Your session is for a different Supabase project than this app URL. Sign out, confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY match one project, then sign in again.',
			),
		};
	}

	const invokeOnce = (t) =>
		customSupabaseClient.functions.invoke(name, {
			...options,
			headers: { ...options.headers, Authorization: `Bearer ${t}` },
		});

	let { data, error } = await invokeOnce(token);
	if (!error) {
		return { data, error: null };
	}

	let { status, parsed, msg } = await parseFunctionsInvokeError(error);

	if (status === 401) {
		const { data: ref, error: refErr } = await customSupabaseClient.auth.refreshSession();
		if (!refErr && ref?.session?.access_token) {
			({ data, error } = await invokeOnce(ref.session.access_token));
			if (!error) {
				return { data, error: null };
			}
			({ status, parsed, msg } = await parseFunctionsInvokeError(error));
		}
	}

	// Gateway rejects user access_token but anon JWT matches this client (works when verify_jwt is false on the function).
	if (status === 401 && isInvalidJwtMessage(msg)) {
		({ data, error } = await invokeOnce(supabaseAnonKey));
		if (!error) {
			return { data, error: null };
		}
		({ status, parsed, msg } = await parseFunctionsInvokeError(error));
	}

	if (msg) {
		const hint =
			status === 401 && isInvalidJwtMessage(msg)
				? ' If this continues, redeploy record-repayment with verify_jwt=false or sign out and sign in again.'
				: '';
		return {
			data: parsed,
			error: new Error(msg + hint),
		};
	}
	return { data, error };
}

export default customSupabaseClient;

export {
	customSupabaseClient,
	customSupabaseClient as supabase,
};

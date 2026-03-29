import { createClient } from '@supabase/supabase-js';

/**
 * Point to any Supabase project via .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
 * The other project must expose the same tables, RPCs, RLS, Storage buckets, and Edge Functions this app expects.
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
 * Invoke a Supabase Edge Function with a user JWT (never the anon key as Bearer).
 * Prefer `getSession()` so the token matches storage; React `session` can lag after refresh.
 */
export async function invokeEdgeFunction(name, options = {}, accessToken) {
	const { data: { session } } = await customSupabaseClient.auth.getSession();
	const token = session?.access_token ?? accessToken ?? null;
	if (!token) {
		return {
			data: null,
			error: Object.assign(new Error('Not authenticated'), { context: null }),
		};
	}
	return customSupabaseClient.functions.invoke(name, {
		...options,
		headers: { ...options.headers, Authorization: `Bearer ${token}` },
	});
}

export default customSupabaseClient;

export {
	customSupabaseClient,
	customSupabaseClient as supabase,
};

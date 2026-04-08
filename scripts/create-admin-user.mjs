/**
 * Create an admin user in auth + public.users (same logic as Edge Function create-admin-user).
 *
 * Requires in .env:
 *   - VITE_SUPABASE_URL or SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (never commit; never expose to Vite client)
 *
 * Usage:
 *   node scripts/create-admin-user.mjs [email] [password] [full_name]
 *
 * Examples:
 *   node scripts/create-admin-user.mjs admin@faharicredits.co.tz
 *   node scripts/create-admin-user.mjs admin@faharicredits.co.tz 'YourSecurePass123' 'Fahari Admin'
 *
 * If password is omitted, a random one is generated and printed once.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotenv() {
	const envPath = join(__dirname, '..', '.env');
	if (!existsSync(envPath)) return;
	const raw = readFileSync(envPath, 'utf8');
	for (const line of raw.split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		if (eq === -1) continue;
		const key = t.slice(0, eq).trim();
		let val = t.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

loadDotenv();

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const argv = process.argv.slice(2);
const email = argv[0] || 'admin@faharicredits.co.tz';
let password = argv[1];
const fullName = argv[2] || 'Fahari Admin';

if (!url || !serviceKey) {
	console.error(
		'Missing VITE_SUPABASE_URL (or SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY in .env — see .env.example',
	);
	process.exit(1);
}

if (!password) {
	password = crypto.randomBytes(16).toString('base64url');
	console.error('[bootstrap] No password argument — generated a temporary password (shown below).');
}

const supabaseAdmin = createClient(url, serviceKey, {
	auth: { autoRefreshToken: false, persistSession: false },
});

let userId;

const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
	email,
	password,
	email_confirm: true,
	user_metadata: {
		full_name: fullName,
		role: 'admin',
		branch_id: null,
	},
});

if (authError) {
	const msg = authError.message || '';
	if (/already|registered|exists/i.test(msg)) {
		const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
		if (listErr) {
			console.error('User may exist but could not list users:', listErr.message);
			process.exit(1);
		}
		const found = listData?.users?.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
		if (!found) {
			console.error('auth.admin.createUser failed:', authError.message);
			process.exit(1);
		}
		userId = found.id;
		console.error('[info] Auth user already exists for this email — syncing public.users only.');
	} else {
		console.error('auth.admin.createUser failed:', authError.message);
		process.exit(1);
	}
} else if (!authData.user) {
	console.error('No user returned from createUser');
	process.exit(1);
} else {
	userId = authData.user.id;
}

const { error: upsertError } = await supabaseAdmin.from('users').upsert(
	{
		id: userId,
		full_name: fullName,
		email,
		role: 'admin',
		branch_id: null,
	},
	{ onConflict: 'id' },
);

if (upsertError) {
	console.error('public.users upsert failed:', upsertError.message);
	process.exit(1);
}

console.log('OK — admin user created.');
console.log('  Email:', email);
console.log('  Password:', password);
console.log('  Full name:', fullName);
console.log('Sign in at your app login with the email and password above (change password after first login).');

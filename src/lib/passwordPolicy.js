/** Minimum length — align with Supabase Auth dashboard (Authentication → Settings). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Client-side password strength check (server/edge must also validate).
 * Supabase Auth can reject weak/leaked passwords when enabled in dashboard.
 */
export function validatePasswordStrength(password) {
	const pwd = String(password ?? '');
	if (pwd.length < MIN_PASSWORD_LENGTH) {
		return {
			ok: false,
			message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
		};
	}
	return { ok: true, message: '' };
}

export function passwordStrengthHint() {
	return `At least ${MIN_PASSWORD_LENGTH} characters. Enable leaked-password protection in Supabase Auth settings.`;
}

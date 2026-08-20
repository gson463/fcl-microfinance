import { supabase } from '@/lib/customSupabaseClient';

export const POLICY_CONFIG_KEYS = [
	'privacyPolicyVersion',
	'securityConsentTitleSw',
	'securityConsentTitleEn',
	'securityConsentSummarySw',
	'securityConsentSummaryEn',
	'securityConsentBodySw',
	'securityConsentBodyEn',
];

export const DEFAULT_POLICY_CONFIG = {
	privacyPolicyVersion: '1',
	securityConsentTitleSw: 'Masharti ya Usalama wa Mfumo',
	securityConsentTitleEn: 'System Security Terms',
	securityConsentSummarySw:
		'Kwa usalama wako na wa shirika, mfumo unatumia taarifa za akaunti, kifaa, na shughuli za uendeshaji ili kuweka mazingira salama, kuzuia matumizi yasiyo idhiniwa, na kuwezesha uwajibikaji wa kazi.',
	securityConsentSummaryEn:
		'For your safety and the organisation\'s, the system uses account, device, and operational activity information to maintain a secure environment, prevent unauthorised use, and support accountability.',
	securityConsentBodySw: `Masharti ya Usalama wa Mfumo

1. Kusudi
Mfumo huu unatumika na wafanyakazi wa shirika kwa uendeshaji wa mikopo na shughuli zinazohusiana. Kwa usalama wako na wa shirika, tunakusanya na kutumia taarifa za uendeshaji ili kuhakikisha matumizi salama na yenye uwajibikaji.

2. Taarifa tunazotumia
• Taarifa za akaunti yako (mf. barua pepe, jina)
• Taarifa za kifaa na kivinjari unachotumia kuingia
• Rekodi za shughuli zako ndani ya mfumo
• Taarifa za uthibitisho wa session ili kuhakikisha ni wewe unatumia akaunti yako

3. Jinsi tunavyowafanya salama
• Tunathibitisha kila session ili kuzuia matumizi yasiyo halali
• Tunahifadhi rekodi za shughuli kwa ukaguzi wa ndani na uwajibikaji
• Tunatumia hatua za kiufundi kulinda data dhidi ya ufikiaji usioruhusiwa

4. Uhifadhi
Baadhi ya taarifa zinaweza kuhifadhiwa kwa muda unaohitajika kwa madhumuni ya usalama, ukaguzi, na ubora wa huduma.

5. Haki zako
Unaweza kuwasiliana na msimamizi wa mfumo kwa maswali kuhusu matumizi ya data. Taarifa zako haziuzwi kwa wahusika wa nje.

6. Kukubali
Kwa kubali, unathibitisha kuwa unaelewa na unakubali matumizi haya ya data kwa madhumuni ya ulinzi na uendeshaji salama wa mfumo. Ukikataa, hutaweza kuendelea kutumia mfumo.`,
	securityConsentBodyEn: `System Security Terms

1. Purpose
This system is used by authorised staff for loan operations and related work. For your safety and the organisation's, we collect and use operational information to ensure secure, accountable use.

2. Information we use
• Your account details (e.g. email, name)
• Device and browser information used to sign in
• Records of your activity within the system
• Session verification data to confirm you are using your account

3. How we keep you safe
• We verify each session to prevent unauthorised access
• We retain activity records for internal review and accountability
• We apply technical safeguards to protect data from unauthorised access

4. Retention
Some information may be retained for as long as needed for security, audit, and service quality purposes.

5. Your rights
You may contact your system administrator with questions about data use. Your information is not sold to third parties.

6. Acceptance
By accepting, you confirm that you understand and agree to this use of data for protection and safe operation of the system. If you decline, you cannot continue using the system.`,
};

export const CHECKBOX_LABEL_SW =
	'Nimesoma na nakubali Masharti ya Usalama — naelewa mfumo unatumia taarifa za uendeshaji wangu kulinda usalama wa mfumo na uwajibikaji wa kazi.';

export const CHECKBOX_LABEL_EN =
	'I have read and accept the Security Terms — I understand the system uses my operational information to protect system security and work accountability.';

function mergePolicyConfig(dbConfig = {}) {
	return {
		...DEFAULT_POLICY_CONFIG,
		...Object.fromEntries(
			POLICY_CONFIG_KEYS.filter((k) => dbConfig[k] != null && String(dbConfig[k]).trim() !== '').map(
				(k) => [k, String(dbConfig[k])],
			),
		),
	};
}

export async function fetchPolicyConfig(client = supabase) {
	const { data, error } = await client
		.from('system_config')
		.select('key, value')
		.in('key', POLICY_CONFIG_KEYS);

	if (error) {
		console.warn('[policyConsent] fetchPolicyConfig', error.message);
		return { config: { ...DEFAULT_POLICY_CONFIG }, error };
	}

	const dbConfig = (data ?? []).reduce((acc, row) => {
		acc[row.key] = row.value;
		return acc;
	}, {});

	return { config: mergePolicyConfig(dbConfig), error: null };
}

export async function checkUserConsent(client, policyVersion) {
	const version = String(policyVersion ?? DEFAULT_POLICY_CONFIG.privacyPolicyVersion).trim();
	const { data, error } = await client.rpc('user_has_policy_consent', {
		p_policy_version: version,
	});
	if (error) {
		return { hasConsent: false, error };
	}
	return { hasConsent: Boolean(data), error: null };
}

export async function recordUserConsent(client, { policyVersion, locale }) {
	const version = String(policyVersion ?? DEFAULT_POLICY_CONFIG.privacyPolicyVersion).trim();
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
	const { data, error } = await client.rpc('record_user_policy_consent', {
		p_policy_version: version,
		p_locale: locale ?? null,
		p_user_agent: ua,
		p_ip_address: null,
	});
	return { id: data, error };
}

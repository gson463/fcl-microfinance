/** Default branding when system_config is empty or unavailable */
export const DEFAULT_SYSTEM_NAME = 'FAHARI CREDIT LIMITED';
export const DEFAULT_TAGLINE = 'Your Financial Friends.';
export const LOGO_PATH = '/fahari-logo.png';

export function resolveLogoUrl(logoUrl) {
	if (logoUrl && String(logoUrl).trim()) return logoUrl;
	return LOGO_PATH;
}

/** Login page — support contacts & developer credit (edit per deployment) */
export const LOGIN_SUPPORT_PHONE = '+255 785 059 140';
export const LOGIN_SUPPORT_WHATSAPP = '+255 748 847 367';
export const LOGIN_SUPPORT_EMAIL = 'develop@plusnology.tech';
export const LOGIN_PLUSNOLOGY_URL = 'https://plusnology.tech';
export const LOGIN_VOGU_ETHICS_URL = 'https://voguethics.org';
export const LOGIN_APP_VERSION = 'v1.0';

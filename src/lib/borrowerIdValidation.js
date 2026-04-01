/** Tanzania NIDA / NIN is 20 numeric digits */
export const NIDA_DIGIT_LENGTH = 20;

/** Strip to digits only (for input + storage when type is national_id) */
export function normalizeNidaDigits(raw) {
    return String(raw ?? '').replace(/\D/g, '');
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateNidaIdentificationNumber(raw) {
    const digits = normalizeNidaDigits(raw);
    if (digits.length !== NIDA_DIGIT_LENGTH) {
        const suffix = digits.length > 0 ? ` You entered ${digits.length}.` : '';
        return {
            ok: false,
            error: `National ID (NIDA) must be exactly ${NIDA_DIGIT_LENGTH} digits (numbers only) — not less than ${NIDA_DIGIT_LENGTH} and not more than ${NIDA_DIGIT_LENGTH}.${suffix}`,
        };
    }
    return { ok: true, value: digits };
}

/** True when ID type is Tanzania National ID (NIDA) */
export function isNationalIdIdentificationType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    return s === 'national_id' || s === 'national id' || s === 'nida';
}

/** NEC-style voter number: T + exactly 12 digits (13 characters). T is uppercase; UI defaults to leading T. */
export const VOTERS_ID_DIGIT_COUNT = 12;
/** Max characters in the ID field: T + 12 digits */
export const VOTERS_ID_MAX_INPUT_LENGTH = 1 + VOTERS_ID_DIGIT_COUNT;

const VOTERS_ID_PREFIX = 'T';

/**
 * Input always keeps leading T; user types digits after it. Empty input becomes T alone.
 * @param {string} raw
 */
export function normalizeVotersIdInput(raw) {
    let s = String(raw ?? '').replace(/[^tT0-9]/g, '');
    if (s.length === 0) {
        return VOTERS_ID_PREFIX;
    }
    if (!/^[tT]/.test(s)) {
        s = VOTERS_ID_PREFIX + s;
    }
    return VOTERS_ID_PREFIX + s.slice(1).replace(/\D/g, '').slice(0, VOTERS_ID_DIGIT_COUNT);
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateVotersIdentificationNumber(raw) {
    let s = String(raw ?? '').replace(/\s/g, '');
    /** Import / paste: 12 digits only → treat as T + digits */
    if (/^\d{12}$/.test(s)) {
        s = `T${s}`;
    }
    if (!/^[Tt]\d{12}$/.test(s)) {
        const afterT = s.replace(/^[Tt]/i, '').replace(/\D/g, '');
        const suffix = afterT.length > 0 ? ` You have ${afterT.length} digit(s) after T (need exactly ${VOTERS_ID_DIGIT_COUNT}).` : '';
        return {
            ok: false,
            error: `Voter's ID must start with T followed by exactly ${VOTERS_ID_DIGIT_COUNT} digits — not less, not more.${suffix}`,
        };
    }
    return { ok: true, value: `${VOTERS_ID_PREFIX}${s.slice(1)}` };
}

/** True when ID type is Voter's ID (NEC) */
export function isVotersIdIdentificationType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    return s === 'voters_id' || s === "voter's id" || s === 'voters id' || s === 'voter id';
}

/**
 * Tanzania TRA driving licence (CDLS): public format varies; we enforce a fixed numeric length for data quality.
 * Change DRIVER_LICENSE_DIGIT_LENGTH if your branch uses a different TRA rule.
 */
export const DRIVER_LICENSE_DIGIT_LENGTH = 10;

export function normalizeDriversLicenseDigits(raw) {
    return String(raw ?? '').replace(/\D/g, '').slice(0, DRIVER_LICENSE_DIGIT_LENGTH);
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateDriversLicenseIdentificationNumber(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length !== DRIVER_LICENSE_DIGIT_LENGTH) {
        const suffix = digits.length > 0 ? ` You entered ${digits.length}.` : '';
        return {
            ok: false,
            error: `Driver's license number must be exactly ${DRIVER_LICENSE_DIGIT_LENGTH} digits (numbers only) — not less, not more.${suffix}`,
        };
    }
    return { ok: true, value: digits };
}

export function isDriversLicenseIdentificationType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    return (
        s === 'drivers_license' ||
        s === "driver's license" ||
        s === 'drivers license' ||
        s === 'driving licence' ||
        s === 'driving license'
    );
}

/** Local mobile: exactly 10 digits */
export const PHONE_DIGIT_LENGTH = 10;

export function normalizePhoneDigitsMax10(raw) {
    return String(raw ?? '')
        .replace(/\D/g, '')
        .slice(0, PHONE_DIGIT_LENGTH);
}

export function validatePhoneNumberTenDigits(raw) {
    const d = normalizePhoneDigitsMax10(raw);
    if (d.length !== PHONE_DIGIT_LENGTH) {
        return {
            ok: false,
            error: `Phone must be exactly ${PHONE_DIGIT_LENGTH} digits (numbers only).`,
        };
    }
    return { ok: true, value: d };
}

/** Guarantor phone: empty, or exactly 10 digits */
export function validateOptionalGuarantorPhone(raw) {
    const d = normalizePhoneDigitsMax10(raw);
    if (d.length === 0) {
        return { ok: true, value: null };
    }
    if (d.length !== PHONE_DIGIT_LENGTH) {
        return {
            ok: false,
            error: `Guarantor phone must be exactly ${PHONE_DIGIT_LENGTH} digits or left empty.`,
        };
    }
    return { ok: true, value: d };
}

/** First name, surname, guarantor name: letters, spaces, hyphen, apostrophe only */
export function normalizePersonNameLettersOnly(raw) {
    return String(raw ?? '').replace(/[^\p{L}\s'-]/gu, '');
}

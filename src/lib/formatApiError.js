/**
 * Turn API error payloads (string or PostgREST-style object) into readable text for toasts.
 * Avoids "[object Object]" when code does String(non-primitive).
 */
export function formatApiErrorValue(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (typeof value === 'object') {
		if (Array.isArray(value)) {
			try {
				return JSON.stringify(value);
			} catch {
				return String(value);
			}
		}
		const msg = value.message;
		if (msg != null && msg !== '') {
			return typeof msg === 'string' ? msg : String(msg);
		}
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

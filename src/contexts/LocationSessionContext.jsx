import React, { createContext, useCallback, useContext, useMemo } from 'react';
import {
	captureSessionLocation as captureLoc,
	clearSessionLocation,
	getSessionLocation as getLoc,
	isSessionLocationReady,
	isGpsExemptEmail,
	SessionLocationRequiredError,
	SESSION_LOCATION_MESSAGES,
} from '@/lib/geolocation';

const LocationSessionContext = createContext(undefined);

export function LocationSessionProvider({ children }) {
	const captureSessionLocation = useCallback(async () => captureLoc(), []);

	const getSessionLocation = useCallback(() => getLoc(), []);

	const clear = useCallback(() => clearSessionLocation(), []);

	const value = useMemo(
		() => ({
			captureSessionLocation,
			getSessionLocation,
			clearSessionLocation: clear,
			isSessionLocationReady,
			isGpsExemptEmail,
			SessionLocationRequiredError,
			SESSION_LOCATION_MESSAGES,
		}),
		[captureSessionLocation, getSessionLocation, clear],
	);

	return (
		<LocationSessionContext.Provider value={value}>{children}</LocationSessionContext.Provider>
	);
}

export function useLocationSession() {
	const ctx = useContext(LocationSessionContext);
	if (ctx === undefined) {
		throw new Error('useLocationSession must be used within LocationSessionProvider');
	}
	return ctx;
}

/** Safe hook for login page before provider nesting issues — re-exports lib directly. */
export { isGpsExemptEmail, SessionLocationRequiredError, SESSION_LOCATION_MESSAGES };

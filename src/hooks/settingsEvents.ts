/** Mirror the event payload before consumers read related settings. */
export function mirrorSetting(key: string, value: unknown) {
	try {
		if (key === "bloom-weather-lat" || key === "bloom-weather-lon" || value == null) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, String(value));
		}
	} catch (error) {
		// A committed file write is still successful when the browser cache is
		// full. Consumers must continue updating from the authoritative event.
		console.warn(`Settings mirror update failed for ${key}:`, error);
	}
}

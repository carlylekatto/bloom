export type SurfaceMode = "fixed" | "smart" | "peek";

export interface OnboardingChoices {
	island: SurfaceMode;
	dock: SurfaceMode;
	autostart: boolean;
	autoUpdate: boolean;
}

function mode(value: unknown, fallback: SurfaceMode): SurfaceMode {
	if (value === "auto-hide") return "smart";
	return value === "fixed" || value === "smart" || value === "peek" ? value : fallback;
}

export function onboardingChoices(
	settings: Record<string, unknown>,
	autostart: boolean
): OnboardingChoices {
	return {
		island: mode(settings["bloom-notch-mode"], "fixed"),
		dock: mode(settings["bloom-dock-mode"], "smart"),
		autostart,
		autoUpdate: settings["bloom-auto-update"] === "true"
	};
}

export async function saveOnboardingChoice<K extends keyof OnboardingChoices>(
	key: K,
	value: OnboardingChoices[K],
	operations: {
		saveSetting: (key: string, value: string) => Promise<void>;
		setAutostart: (enabled: boolean) => Promise<void>;
	}
) {
	if (key === "autostart") {
		await operations.setAutostart(value as boolean);
		return;
	}
	const settingKeys = {
		island: "bloom-notch-mode",
		dock: "bloom-dock-mode",
		autoUpdate: "bloom-auto-update"
	};
	await operations.saveSetting(settingKeys[key as keyof typeof settingKeys], String(value));
}

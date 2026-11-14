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

export async function saveOnboardingChoices(
	choices: OnboardingChoices,
	operations: {
		saveSetting: (key: string, value: string) => Promise<void>;
		setAutostart: (enabled: boolean) => Promise<void>;
	}
) {
	await operations.saveSetting("bloom-notch-mode", choices.island);
	await operations.saveSetting("bloom-dock-mode", choices.dock);
	await operations.saveSetting("bloom-auto-update", String(choices.autoUpdate));
	await operations.setAutostart(choices.autostart);
}

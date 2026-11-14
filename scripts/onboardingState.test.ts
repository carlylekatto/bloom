import { expect, test } from "bun:test";
import { onboardingChoices, saveOnboardingChoices } from "../src/onboardingState";

test("new installs select Fixed Island and Smart Dock without opting into updates or startup", () => {
	expect(onboardingChoices({}, false)).toEqual({
		island: "fixed",
		dock: "smart",
		autostart: false,
		autoUpdate: false
	});
});

test("replaying setup keeps existing choices and handles legacy modes", () => {
	expect(
		onboardingChoices(
			{ "bloom-notch-mode": "peek", "bloom-dock-mode": "auto-hide", "bloom-auto-update": "true" },
			true
		)
	).toEqual({ island: "peek", dock: "smart", autostart: true, autoUpdate: true });
	expect(
		onboardingChoices({ "bloom-notch-mode": "invalid", "bloom-dock-mode": null }, false).island
	).toBe("fixed");
});

test("saves string settings and leaves startup to its plugin", async () => {
	const writes: string[][] = [];
	await saveOnboardingChoices(onboardingChoices({}, false), {
		saveSetting: async (key, value) => {
			writes.push([key, value]);
		},
		setAutostart: async (value) => {
			writes.push(["autostart-plugin", String(value)]);
		}
	});
	expect(writes).toEqual([
		["bloom-notch-mode", "fixed"],
		["bloom-dock-mode", "smart"],
		["bloom-auto-update", "false"],
		["autostart-plugin", "false"]
	]);
});

test("a failed setting save stops the remaining setup changes", async () => {
	let calledPlugin = false;
	await expect(
		saveOnboardingChoices(onboardingChoices({}, true), {
			saveSetting: async () => {
				throw new Error("read-only settings");
			},
			setAutostart: async () => {
				calledPlugin = true;
			}
		})
	).rejects.toThrow("read-only settings");
	expect(calledPlugin).toBe(false);
});

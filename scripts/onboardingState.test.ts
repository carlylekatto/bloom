import { expect, test } from "bun:test";
import { onboardingChoices, saveOnboardingChoice } from "../src/onboardingState";

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

test("each live choice saves only its setting; startup uses the plugin", async () => {
	const writes: string[][] = [];
	const operations = {
		saveSetting: async (key: string, value: string) => {
			writes.push([key, value]);
		},
		setAutostart: async (value: boolean) => {
			writes.push(["autostart-plugin", String(value)]);
		}
	};
	await saveOnboardingChoice("dock", "peek", operations);
	expect(writes).toEqual([["bloom-dock-mode", "peek"]]);
	await saveOnboardingChoice("island", "smart", operations);
	await saveOnboardingChoice("autoUpdate", true, operations);
	await saveOnboardingChoice("autostart", true, operations);
	expect(writes.slice(1)).toEqual([
		["bloom-notch-mode", "smart"],
		["bloom-auto-update", "true"],
		["autostart-plugin", "true"]
	]);
});

test("live save errors propagate without modifying unrelated choices", async () => {
	let calledPlugin = false;
	await expect(
		saveOnboardingChoice("dock", "fixed", {
			saveSetting: async () => {
				throw new Error("read-only settings");
			},
			setAutostart: async () => {
				calledPlugin = true;
			}
		})
	).rejects.toThrow("read-only settings");
	expect(calledPlugin).toBe(false);
	await expect(
		saveOnboardingChoice("autostart", true, {
			saveSetting: async () => {
				throw new Error("unexpected setting write");
			},
			setAutostart: async () => {
				throw new Error("startup denied");
			}
		})
	).rejects.toThrow("startup denied");
});

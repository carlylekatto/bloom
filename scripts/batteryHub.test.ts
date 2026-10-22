import { describe, expect, test } from "bun:test";
import { groupHubEntries, urgentLevel, type HubEntry } from "../src/devices/batteryHub";

const entry = (name: string, kind: string, level: number | null, rest: Partial<HubEntry> = {}): HubEntry => ({
	id: name,
	name,
	kind,
	art: null,
	level,
	charging: false,
	buds: null,
	...rest
});

const titles = (entries: HubEntry[], threshold = 20) =>
	groupHubEntries(entries, threshold).map((g) => `${g.title}: ${g.entries.map((e) => e.name).join(", ")}`);

describe("Battery hub groups", () => {
	test("puts low devices first, then groups by type", () => {
		expect(
			titles([
				entry("Keyboard", "keyboard", 70),
				entry("iPhone", "phone", 80),
				entry("Laptop", "pc", 64, { charging: true }),
				entry("MX Anywhere", "mouse", 9),
				entry("AirPods Pro", "audio", 82),
				entry("Galaxy Watch6", "wearable", 55),
				entry("Gadget", "other", null)
			])
		).toEqual([
			"Needs charging: MX Anywhere",
			"This PC: Laptop",
			"Audio: AirPods Pro",
			"Phone & watch: Galaxy Watch6, iPhone",
			"Accessories: Keyboard",
			"Other: Gadget"
		]);
	});

	test("judges earbuds by their lowest part that isn't charging", () => {
		const buds = entry("Buds", "audio", 70, {
			buds: {
				left: { level: 12, charging: false },
				right: { level: 90, charging: false },
				case: { level: 40, charging: false }
			}
		});
		expect(urgentLevel(buds)).toBe(12);
		expect(titles([buds])).toEqual(["Needs charging: Buds"]);
		// The low bud is charging in the case: nothing is urgent.
		const charging = { ...buds, buds: { ...buds.buds!, left: { level: 12, charging: true } } };
		expect(urgentLevel(charging)).toBe(40);
		expect(titles([charging])).toEqual(["Audio: Buds"]);
	});

	test("a charging device is never urgent, and the threshold is the user's", () => {
		expect(titles([entry("Laptop", "pc", 5, { charging: true })])).toEqual(["This PC: Laptop"]);
		expect(titles([entry("Mouse", "mouse", 25)], 30)).toEqual(["Needs charging: Mouse"]);
		expect(titles([entry("Mouse", "mouse", 25)], 20)).toEqual(["Accessories: Mouse"]);
	});

	test("sorts lowest first and unknown levels last", () => {
		expect(
			titles([entry("B", "audio", null), entry("C", "audio", 60), entry("A", "audio", 30), entry("D", "audio", 30)])
		).toEqual(["Audio: A, D, C, B"]);
	});
});

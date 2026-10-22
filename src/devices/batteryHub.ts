import type { DeviceArtKey } from "./art";

export interface BudLevel {
	level: number;
	charging: boolean;
}

/** Each bud's and the case's battery, from the backend's `bluetooth-buds`. */
export interface BudsBattery {
	left: BudLevel | null;
	right: BudLevel | null;
	case: BudLevel | null;
}

/** One row in Battery hub. */
export interface HubEntry {
	id: string;
	name: string;
	/** "pc", or a Bluetooth kind: "audio", "phone", "wearable", "mouse", ... */
	kind: string;
	art: DeviceArtKey | null;
	/** Percent, when known. */
	level: number | null;
	charging: boolean;
	/** Each bud's and the case's level, for earbuds that report them. */
	buds: BudsBattery | null;
}

export type HubGroupKey = "low" | "pc" | "audio" | "phone" | "accessories" | "other";

export interface HubGroup {
	key: HubGroupKey;
	title: string;
	entries: HubEntry[];
}

const GROUPS: { key: HubGroupKey; title: string }[] = [
	{ key: "low", title: "Needs charging" },
	{ key: "pc", title: "This PC" },
	{ key: "audio", title: "Audio" },
	{ key: "phone", title: "Phone & watch" },
	{ key: "accessories", title: "Accessories" },
	{ key: "other", title: "Other" }
];

function typeGroup(kind: string): HubGroupKey {
	switch (kind) {
		case "pc":
			return "pc";
		case "audio":
			return "audio";
		case "phone":
		case "wearable":
			return "phone";
		case "mouse":
		case "keyboard":
		case "gamepad":
			return "accessories";
		default:
			return "other";
	}
}

function budParts(buds: BudsBattery): BudLevel[] {
	return [buds.left, buds.right, buds.case].filter((p): p is BudLevel => p !== null);
}

/**
 * The level that decides how urgent a device is: its lowest part that isn't
 * charging (a flat bud needs charging even if the other is full), or null
 * when nothing is known or everything is charging.
 */
export function urgentLevel(entry: HubEntry): number | null {
	const parts = entry.buds
		? budParts(entry.buds)
		: entry.level !== null
			? [{ level: entry.level, charging: entry.charging }]
			: [];
	const draining = parts.filter((p) => !p.charging).map((p) => p.level);
	return draining.length > 0 ? Math.min(...draining) : null;
}

/** The level a device sorts by: its lowest known part. */
function sortLevel(entry: HubEntry): number | null {
	const levels = entry.buds ? budParts(entry.buds).map((p) => p.level) : entry.level !== null ? [entry.level] : [];
	return levels.length > 0 ? Math.min(...levels) : null;
}

function byUrgency(a: HubEntry, b: HubEntry): number {
	const la = sortLevel(a);
	const lb = sortLevel(b);
	if (la !== lb) {
		// Devices without a level go last.
		if (la === null) return 1;
		if (lb === null) return -1;
		return la - lb;
	}
	return a.name.localeCompare(b.name);
}

/**
 * Battery hub's groups, by priority: everything at or below `threshold` that
 * isn't charging, then the PC, audio, phones and watches, accessories and the
 * rest. The lowest battery comes first in each group; empty groups are left
 * out.
 */
export function groupHubEntries(entries: HubEntry[], threshold: number): HubGroup[] {
	const buckets = new Map<HubGroupKey, HubEntry[]>();
	for (const entry of entries) {
		const urgent = urgentLevel(entry);
		const key = urgent !== null && urgent <= threshold ? "low" : typeGroup(entry.kind);
		buckets.set(key, [...(buckets.get(key) ?? []), entry]);
	}
	return GROUPS.filter((g) => buckets.has(g.key)).map((g) => ({
		...g,
		entries: [...(buckets.get(g.key) ?? [])].sort(byUrgency)
	}));
}

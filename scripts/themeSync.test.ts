import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const listeners = new Map<string, (event: { payload: any }) => void>();
let load: Promise<Record<string, unknown>> = Promise.resolve({});
let accent: Promise<string> = Promise.resolve("#007aff");
mock.module("@tauri-apps/api/core", () => ({
	invoke: (command: string) => (command === "load_settings" ? load : accent)
}));
mock.module("@tauri-apps/api/event", () => ({
	listen: async (name: string, handler: (event: { payload: any }) => void) => {
		listeners.set(name, handler);
		return () => listeners.delete(name);
	}
}));

const storage = new Map<string, string>();
const classes = new Set<string>();
const properties = new Map<string, string>();
let rejectMirrorWrites = false;
const originals = { localStorage: globalThis.localStorage, document: globalThis.document };
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (rejectMirrorWrites) throw new Error("Quota exceeded");
			storage.set(key, value);
		},
		removeItem: (key: string) => storage.delete(key)
	}
});
Object.defineProperty(globalThis, "document", {
	configurable: true,
	value: {
		documentElement: {
			style: { setProperty: (key: string, value: string) => properties.set(key, value) },
			classList: {
				add: (...names: string[]) => names.forEach((name) => classes.add(name)),
				remove: (...names: string[]) => names.forEach((name) => classes.delete(name))
			}
		}
	}
});
const { initTheme, applyTheme } = await import("../src/theme");
const { mirrorSetting } = await import("../src/hooks/settingsEvents");

beforeEach(() => {
	storage.clear();
	classes.clear();
	properties.clear();
	listeners.clear();
	rejectMirrorWrites = false;
	load = Promise.resolve({});
	accent = Promise.resolve("#007aff");
});
afterAll(() => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: originals.localStorage
	});
	Object.defineProperty(globalThis, "document", { configurable: true, value: originals.document });
	mock.restore();
});
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

test("committed events apply dark → light → custom → dark before the saving caller updates storage", async () => {
	initTheme();
	await settle();
	for (const mode of ["light", "custom", "dark"]) {
		listeners.get("settings-changed")!({ payload: { key: "bloom-theme-mode", value: mode } });
		expect(classes.has(`theme-${mode}`)).toBe(true);
		expect(localStorage.getItem("bloom-theme-mode")).toBe(mode);
	}
});

test("external edits apply their own payload regardless of hook registration order", async () => {
	initTheme();
	await settle();
	listeners.get("settings-external-changed")!({
		payload: { key: "bloom-theme-mode", value: "light" }
	});
	expect(classes.has("theme-light")).toBe(true);
	listeners.get("settings-external-changed")!({
		payload: { key: "bloom-theme-mode", value: null }
	});
	expect(classes.has("theme-dark")).toBe(true);
});

test("startup defaults do not create mirror entries absent from the saved file", async () => {
	initTheme();
	await settle();
	expect(classes.has("theme-dark")).toBe(true);
	expect(storage.size).toBe(0);
});

test("a startup read cannot roll back a newer committed theme", async () => {
	let resolve!: (settings: Record<string, unknown>) => void;
	load = new Promise((r) => {
		resolve = r;
	});
	initTheme();
	listeners.get("settings-changed")!({ payload: { key: "bloom-theme-mode", value: "light" } });
	resolve({ "bloom-theme-mode": "dark" });
	await settle();
	expect(classes.has("theme-light")).toBe(true);
	expect(localStorage.getItem("bloom-theme-mode")).toBe("light");
});

test("a theme removed during startup uses defaults rather than the stale startup mode", async () => {
	localStorage.setItem("bloom-theme-mode", "custom");
	let resolve!: (settings: Record<string, unknown>) => void;
	load = new Promise((r) => {
		resolve = r;
	});
	initTheme();
	listeners.get("settings-external-changed")!({
		payload: { key: "bloom-theme-mode", value: null }
	});
	resolve({ "bloom-theme-mode": "custom" });
	await settle();
	expect(classes.has("theme-dark")).toBe(true);
});

test("an old adaptive request cannot paint over a newer choice", async () => {
	let resolve!: (color: string) => void;
	accent = new Promise((r) => {
		resolve = r;
	});
	const pending = applyTheme("adaptive", "#007aff");
	await applyTheme("light", "#007aff");
	resolve("#ff0000");
	await pending;
	expect(classes.has("theme-light")).toBe(true);
	expect(classes.has("theme-adaptive")).toBe(false);
});

test("all setting events mirror values while coordinates remain private to the backend", () => {
	mirrorSetting("bloom-dock-enabled", false);
	expect(localStorage.getItem("bloom-dock-enabled")).toBe("false");
	mirrorSetting("bloom-scale", 1.25);
	expect(localStorage.getItem("bloom-scale")).toBe("1.25");
	mirrorSetting("bloom-weather-lat", "50");
	expect(localStorage.getItem("bloom-weather-lat")).toBeNull();
	mirrorSetting("bloom-scale", null);
	expect(localStorage.getItem("bloom-scale")).toBeNull();
});

test("a committed theme still applies if the browser mirror cannot be written", async () => {
	initTheme();
	await settle();
	rejectMirrorWrites = true;
	const warn = console.warn;
	console.warn = () => {};
	try {
		listeners.get("settings-changed")!({ payload: { key: "bloom-theme-mode", value: "custom" } });
		listeners.get("settings-changed")!({
			payload: { key: "bloom-theme-brightness", value: "0.8" }
		});
		expect(classes.has("theme-custom")).toBe(true);
		expect(classes.has("light-mode")).toBe(true);
	} finally {
		console.warn = warn;
	}
});

test("a disposed initialization cannot apply a delayed startup read", async () => {
	let resolve!: (settings: Record<string, unknown>) => void;
	load = new Promise((r) => {
		resolve = r;
	});
	const dispose = initTheme();
	dispose();
	await applyTheme("light", "#007aff");
	resolve({ "bloom-theme-mode": "custom" });
	await settle();
	expect(classes.has("theme-light")).toBe(true);
});

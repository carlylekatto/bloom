import { describe, expect, mock, test } from "bun:test";
import {
	createTrayLaunchFallback,
	mergeTrayApps,
	selectDockTrayApps,
	type AppInfo,
	type TrayApp
} from "../src/dockApps";
const tray: TrayApp = {
	name: "Discord",
	path: "C:\\Apps\\Discord.exe",
	tray_ids: ["42"],
	window_handles: [11, 12]
};
const windowApp: AppInfo = {
	name: "Discord",
	path: "com.squirrel.Discord.Discord",
	icon: null,
	is_running: true,
	hwnd: 11,
	all_hwnds: [[11, "Discord"]]
};
describe("dock tray lifecycle", () => {
	test("merges a helper-owned Steam window through its resolved executable identity", () => {
		const steam = { ...tray, path: "C:\\Steam\\steam.exe", window_handles: [22] };
		const helper = {
			...windowApp,
			path: "c:/steam/Steam.exe",
			hwnd: 33,
			all_hwnds: [[33, "Steam"]] as [number, string][]
		};
		const selected = selectDockTrayApps([helper], [steam], new Set(), () => false);
		expect(selected.visible).toEqual([steam]);
		expect(mergeTrayApps([helper], selected.visible)).toMatchObject([
			{ path: helper.path, tray_ids: ["42"], is_background: false }
		]);
	});
	test("does not attach a shared browser tray by executable path alone", () => {
		const browserTray = { ...tray, path: "C:\\Browser\\brave.exe" };
		const browserWindow = {
			...windowApp,
			path: browserTray.path,
			hwnd: 99,
			all_hwnds: [[99, "Browser"]] as [number, string][]
		};
		expect(mergeTrayApps([browserWindow], [browserTray])).toHaveLength(2);
	});
	test("does not show every tray app when the dock starts", () => {
		const selected = selectDockTrayApps([], [tray], new Set(), () => false);
		expect(selected.visible).toEqual([]);
		expect(selected.observed.size).toBe(0);
	});
	test("shows an unpinned app only after its window was observed, then forgets it on exit", () => {
		const opened = selectDockTrayApps([windowApp], [tray], new Set(), () => false);
		expect(opened.visible).toEqual([tray]);
		const background = selectDockTrayApps([], [tray], opened.observed, () => false);
		expect(mergeTrayApps([], background.visible)[0].is_background).toBe(true);
		const exited = selectDockTrayApps([], [], background.observed, () => false);
		expect(exited.observed.size).toBe(0);
		expect(selectDockTrayApps([], [tray], exited.observed, () => false).visible).toEqual([]);
	});
	test("shows a pinned app's background dot immediately at startup", () => {
		const selected = selectDockTrayApps([], [tray], new Set(), (app) => app.path === tray.path);
		expect(mergeTrayApps([], selected.visible)[0]).toMatchObject({
			is_background: true,
			tray_ids: ["42"]
		});
		expect(selected.observed.size).toBe(0);
	});
	test("does not treat an unrelated same-name window as opening the tray app", () => {
		const other = { ...windowApp, hwnd: 99, all_hwnds: [[99, "Discord"]] as [number, string][] };
		expect(selectDockTrayApps([other], [tray], new Set(), () => false).visible).toEqual([]);
	});
	test("keeps a zero-window app running with exactly the tray identity", () => {
		const apps = mergeTrayApps([], [tray]);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({
			is_running: true,
			is_background: true,
			all_hwnds: [],
			tray_ids: ["42"]
		});
		expect(apps[0].hwnd).toBeUndefined();
	});
	test("reconciles a shell-id window with its executable tray without a duplicate", () => {
		const apps = mergeTrayApps([windowApp], [tray]);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({ path: windowApp.path, is_background: false, tray_ids: ["42"] });
		expect(windowApp.tray_ids).toBeUndefined();
	});
	test("returns to background and disappears after a true exit", () => {
		expect(mergeTrayApps([windowApp], [tray])[0].is_background).toBe(false);
		expect(mergeTrayApps([], [tray])[0].is_background).toBe(true);
		expect(mergeTrayApps([], [])).toEqual([]);
	});
	test("does not collapse independent PWAs or attach a shared tray to one of them", () => {
		const second = {
			...windowApp,
			name: "Other PWA",
			path: "other-id",
			hwnd: 12,
			all_hwnds: [[12, "Other"]] as [number, string][]
		};
		const apps = mergeTrayApps([windowApp, second], [tray]);
		expect(apps).toHaveLength(2);
		expect(apps.every((a) => !a.is_background && a.tray_ids === undefined)).toBe(true);
	});
	test("does not match a different process by display name", () => {
		const other = { ...windowApp, hwnd: 99, all_hwnds: [[99, "Discord"]] as [number, string][] };
		expect(mergeTrayApps([other], [tray])).toHaveLength(2);
	});
});

describe("pinned tray launch fallback", () => {
	const app: AppInfo = { ...windowApp, is_pinned: true, is_background: true };
	test("coalesces repeated clicks and launches once if tray activation produced no window", async () => {
		const launched = Promise.withResolvers<void>();
		const launch = mock(async () => {
			launched.resolve();
		});
		const fallback = createTrayLaunchFallback(
			{ hasWindow: async () => false, launch, onError: () => {} },
			0
		);
		for (let i = 0; i < 5; i++) fallback.schedule(app);
		await launched.promise;
		expect(launch).toHaveBeenCalledTimes(1);
		fallback.dispose();
	});
	test("leaves apps that opened a window through their tray icon alone", async () => {
		const checked = Promise.withResolvers<void>();
		const launch = mock(async () => {});
		const fallback = createTrayLaunchFallback(
			{
				hasWindow: async () => {
					checked.resolve();
					return true;
				},
				launch,
				onError: () => {}
			},
			0
		);
		fallback.schedule(app);
		await checked.promise;
		await Promise.resolve();
		expect(launch).not.toHaveBeenCalled();
		fallback.dispose();
	});
	test("does not relaunch unpinned items and cancels scheduled work on teardown", async () => {
		const hasWindow = mock(async () => false);
		const fallback = createTrayLaunchFallback(
			{ hasWindow, launch: async () => {}, onError: () => {} },
			0
		);
		fallback.schedule({ ...app, is_pinned: false });
		await Bun.sleep(10);
		expect(hasWindow).not.toHaveBeenCalled();
		fallback.schedule(app);
		fallback.dispose();
		await Bun.sleep(10);
		expect(hasWindow).not.toHaveBeenCalled();
	});
	test("does not launch when the dock is disposed during a window check", async () => {
		const started = Promise.withResolvers<void>();
		const result = Promise.withResolvers<boolean>();
		const launch = mock(async () => {});
		const fallback = createTrayLaunchFallback(
			{
				hasWindow: () => {
					started.resolve();
					return result.promise;
				},
				launch,
				onError: () => {}
			},
			0
		);
		fallback.schedule(app);
		await started.promise;
		fallback.dispose();
		result.resolve(false);
		await Promise.resolve();
		expect(launch).not.toHaveBeenCalled();
	});
});

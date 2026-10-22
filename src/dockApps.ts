export interface AppInfo {
	name: string;
	path: string;
	icon: string | null;
	is_running: boolean;
	is_pinned?: boolean;
	hwnd?: number;
	executable?: string;
	all_hwnds?: [number, string][];
	tray_ids?: string[];
	is_background?: boolean;
}

export interface TrayApp {
	name: string;
	path: string;
	tray_ids: string[];
	window_handles: number[];
}

// A background item must never fall through to the executable launch route.
// An app with more than one tray icon has no single icon to activate, so the
// user is told to pick one from the context menu rather than the dock
// launching the executable behind the app's back.
export function backgroundTrayId(app: AppInfo): string {
	if (app.tray_ids?.length !== 1) {
		throw new Error("Select this app's tray icon from its dock context menu.");
	}
	return app.tray_ids[0];
}

// Steam ignores a single tray activation. For a pinned background item only,
// launch its saved target if no window appeared after the tray click. Coalesce
// repeated clicks and cancel both timers and in-flight checks on dock teardown.
export function createTrayLaunchFallback(
	actions: {
		hasWindow: (app: AppInfo) => Promise<boolean>;
		launch: (app: AppInfo) => Promise<void>;
		onError: (app: AppInfo, error: unknown) => void;
	},
	delayMs = 1500
) {
	const pending = new Map<string, ReturnType<typeof setTimeout>>();
	let disposed = false;
	return {
		schedule(app: AppInfo) {
			if (disposed || !app.is_pinned || !app.is_background) return;
			const key = app.path.toLowerCase().replace(/\\/g, "/");
			if (pending.has(key)) return;
			const timer = setTimeout(async () => {
				try {
					const hasWindow = await actions.hasWindow(app);
					if (!disposed && !hasWindow) await actions.launch(app);
				} catch (error) {
					if (!disposed) actions.onError(app, error);
				} finally {
					pending.delete(key);
				}
			}, delayMs);
			pending.set(key, timer);
		},
		dispose() {
			disposed = true;
			for (const timer of pending.values()) clearTimeout(timer);
			pending.clear();
		}
	};
}

const trayPath = (app: TrayApp) => app.path.toLowerCase().replace(/\\/g, "/");

const isBrowserHostPath = (p: string) => /(msedge|chrome|brave|vivaldi|firefox)\.exe$/i.test(p);

const ownsVisibleWindow = (window: AppInfo, tray: TrayApp) =>
	(window.all_hwnds ?? (window.hwnd ? [[window.hwnd, window.name]] : [])).some(([hwnd]) =>
		tray.window_handles.includes(hwnd as number)
	) ||
	// A window whose UI runs in a helper process (Steam's steamwebhelper.exe)
	// is reported under the app's own exe; its tray icon belongs to that exe.
	// Browser hosts are excluded: one exe hosts many unrelated web apps.
	(!isBrowserHostPath(window.path) &&
		window.path.toLowerCase().replace(/\\/g, "/") === trayPath(tray));

// An unpinned notification icon becomes a dock item only after its app has
// appeared with a window. Pinned apps are eligible immediately at startup.
// Forget observed apps when their tray icon exits, so a later tray-only launch
// does not inherit a previous session's dock slot.
export function selectDockTrayApps(
	windows: AppInfo[],
	tray: TrayApp[],
	previouslyOpened: Set<string>,
	isPinned: (app: TrayApp) => boolean
): { visible: TrayApp[]; observed: Set<string> } {
	const observed = new Set<string>();
	for (const app of tray) {
		const path = trayPath(app);
		if (previouslyOpened.has(path) || windows.some((window) => ownsVisibleWindow(window, app))) {
			observed.add(path);
		}
	}
	return {
		visible: tray.filter((app) => observed.has(trayPath(app)) || isPinned(app)),
		observed
	};
}

// Associate through actual owner windows, including AUMID/PWA entries whose
// launch path differs from their executable. Never attach a tray to a different
// app just because it has the same display name or executable basename.
export function mergeTrayApps(windows: AppInfo[], tray: TrayApp[]): AppInfo[] {
	const result = windows.map((app) => ({
		...app,
		is_background: false,
		tray_ids: undefined as string[] | undefined
	}));
	for (const app of tray) {
		const owners = result.filter((item) => ownsVisibleWindow(item, app));
		if (owners.length) {
			// A browser tray can own several unrelated PWAs. Keep the running
			// items distinct and don't give any one PWA the browser's tray menu.
			if (owners.length === 1) owners[0].tray_ids = app.tray_ids;
			continue;
		}
		result.push({
			name: app.name,
			path: app.path,
			icon: null,
			is_running: true,
			is_background: true,
			all_hwnds: [],
			tray_ids: app.tray_ids,
			executable: app.path.split(/[\\/]/).pop()
		});
	}
	return result;
}

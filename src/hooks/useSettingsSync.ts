import { useEffect, useRef } from "react";
import { listen, type Event } from "@tauri-apps/api/event";
import { mirrorSetting } from "./settingsEvents";

type SettingSetter = (value: any) => void;
type SettingHandler = SettingSetter | { set: SettingSetter; defaultValue: unknown };

function convertSettingValue(value: any): any {
	if (value === "true") return true;
	if (value === "false") return false;
	if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value)))
		return Number(value);
	return value;
}

/**
 * Centralized settings sync hook. Listens to:
 * - `settings-changed` — emitted by save_setting (bloom keys, native values)
 * - `settings-external-changed` — emitted by file watcher for external edits (bloom keys, string values)
 *
 * Both events use the same bloom-prefixed keys (e.g. "bloom-dock-enabled").
 * Values may pass through String() conversion in the frontend, producing
 * "true"/"false" strings — the hook auto-converts these to booleans.
 *
 * Uses a ref for handlers so listeners are registered once (not re-registered
 * on every render when a new object literal is passed).
 *
 * @param handlers - Map of bloom-prefixed keys to setters, optionally with a default for removed keys
 * @param deps - Optional additional dependency array
 */
export function useSettingsSync(
	handlers: Record<string, SettingHandler>,
	deps?: React.DependencyList
) {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const onSetting = ({ payload }: Event<{ key: string; value: unknown }>) => {
			const { key, value } = payload;
			mirrorSetting(key, value);
			const handler = handlersRef.current[key];
			if (typeof handler === "function") {
				if (value != null) handler(convertSettingValue(value));
			} else if (handler) {
				handler.set(convertSettingValue(value ?? handler.defaultValue));
			}
		};
		const unlistenSC = listen("settings-changed", onSetting);
		const unlistenSEC = listen("settings-external-changed", onSetting);

		return () => {
			unlistenSC.then((fn) => fn());
			unlistenSEC.then((fn) => fn());
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps ?? []);
}

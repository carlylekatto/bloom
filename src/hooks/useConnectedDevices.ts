import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UsbIdentity } from "../devices/usbArtFor";

interface BtDevice {
	id: string;
	name: string;
	kind: string;
	form: string | null;
	connected: boolean;
	battery: number | null;
}

interface WiredDevice extends UsbIdentity {
	id: string;
}

export interface PcBattery {
	present: boolean;
	percent: number | null;
	plugged_in: boolean;
	charging: boolean;
	seconds_left: number | null;
	seconds_to_full: number | null;
}

export interface ConnectedDevicesState {
	devices: BtDevice[] | null;
	wired: WiredDevice[];
	pc: PcBattery | null;
}

/** Keep the device snapshot alive across panel switches, while the feature is enabled. */
export function useConnectedDevices(enabled: boolean): ConnectedDevicesState {
	const [snapshot, setSnapshot] = useState<ConnectedDevicesState>({ devices: null, wired: [], pc: null });

	useEffect(() => {
		if (!enabled) return;
		let disposed = false;
		let refreshing = false;
		let refreshAgain = false;
		let debounce: number | null = null;

		const refresh = async () => {
			if (disposed) return;
			if (refreshing) {
				refreshAgain = true;
				return;
			}
			refreshing = true;
			const [devices, usb, jack, pc] = await Promise.all([
				invoke<BtDevice[]>("bluetooth_list_devices").catch(() => null),
				invoke<WiredDevice[]>("usb_list_devices").catch(() => null),
				invoke<WiredDevice[]>("jack_list_devices").catch(() => null),
				invoke<PcBattery>("get_battery_details").catch(() => null)
			]);
			if (!disposed) {
				// Publish one complete snapshot; transient errors keep the last good data.
				setSnapshot((previous) => ({
					devices: devices ?? previous.devices ?? [],
					wired: [
						...(jack ?? previous.wired.filter((device) => device.class.startsWith("jack-"))),
						...(usb ?? previous.wired.filter((device) => !device.class.startsWith("jack-")))
					],
					pc: pc ?? previous.pc
				}));
			}
			refreshing = false;
			if (refreshAgain && !disposed) {
				refreshAgain = false;
				void refresh();
			}
		};
		const later = () => {
			if (disposed) return;
			if (debounce !== null) window.clearTimeout(debounce);
			debounce = window.setTimeout(() => {
				debounce = null;
				void refresh();
			}, 300);
		};
		const unlisteners = ["bluetooth-changed", "bluetooth-battery", "usb-connection", "wired-audio-connection"].map(
			(event) => listen(event, later)
		);
		void refresh();
		// Keep the PC's time remaining fresh even between visits.
		const tick = window.setInterval(() => void refresh(), 60_000);
		return () => {
			disposed = true;
			if (debounce !== null) window.clearTimeout(debounce);
			window.clearInterval(tick);
			unlisteners.forEach((unlisten) => unlisten.then((stop) => stop()));
		};
	}, [enabled]);

	return snapshot;
}

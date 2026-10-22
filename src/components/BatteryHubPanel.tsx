import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BatteryCharging, Laptop, LoaderCircle, Zap } from "lucide-react";
import { DeviceArt } from "../devices/DeviceArt";
import { deviceArtFor } from "../devices/deviceArtFor";
import { deviceLookFor } from "../devices/deviceLooks";
import {
	groupHubEntries,
	type BudLevel,
	type BudsBattery,
	type HubEntry
} from "../devices/batteryHub";
import "./QuickPanel.css";

interface BtDevice {
	id: string;
	name: string;
	kind: string;
	form: string | null;
	connected: boolean;
	battery: number | null;
}

interface PcBattery {
	present: boolean;
	percent: number | null;
	plugged_in: boolean;
	charging: boolean;
	seconds_left: number | null;
	seconds_to_full: number | null;
}

interface BatteryHubPanelProps {
	/** Each bud's and the case's level, by device id, as last reported. */
	buds: Record<string, BudsBattery>;
	/** The user's low battery threshold, in percent. */
	lowThreshold: number;
}

function duration(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function pcStatus(pc: PcBattery): string {
	if (pc.charging) return pc.seconds_to_full ? `Charging · ${duration(pc.seconds_to_full)} to full` : "Charging";
	if (pc.plugged_in) return "Plugged in";
	return pc.seconds_left ? `${duration(pc.seconds_left)} left` : "On battery";
}

/** One level: its percent over a thin bar, green, or red when low. */
function Meter({ label, part, low }: { label?: string; part: BudLevel; low: boolean }) {
	return (
		<div className={`bh-meter${low ? " low" : ""}${part.charging ? " charging" : ""}`}>
			<span className="bh-meter-value">
				{label && <span className="bh-meter-label">{label}</span>}
				{part.level}%{part.charging && <Zap className="bh-meter-bolt" />}
			</span>
			<span className="bh-meter-bar">
				<span style={{ width: `${Math.max(4, part.level)}%` }} />
			</span>
		</div>
	);
}

/**
 * Battery hub: every connected device's battery in one place, by priority.
 * Devices that need charging come first, then this PC, audio, phones and
 * watches, accessories and the rest.
 */
export function BatteryHubPanel({ buds, lowThreshold }: BatteryHubPanelProps) {
	const [devices, setDevices] = useState<BtDevice[] | null>(null);
	const [pc, setPc] = useState<PcBattery | null>(null);

	const refresh = useCallback(async () => {
		try {
			setDevices(await invoke<BtDevice[]>("bluetooth_list_devices"));
		} catch (e) {
			console.error("[battery hub] list failed:", e);
			setDevices([]);
		}
		invoke<PcBattery>("get_battery_details")
			.then(setPc)
			.catch(() => setPc(null));
	}, []);

	useEffect(() => {
		void refresh();
		// Earbuds' own levels go stale; read them again (the backend skips
		// any read in the last minute and a half).
		invoke("bluetooth_refresh_buds").catch(() => {});
		let debounce: number | null = null;
		const later = () => {
			if (debounce !== null) window.clearTimeout(debounce);
			debounce = window.setTimeout(() => {
				debounce = null;
				void refresh();
			}, 300);
		};
		const unlistenChanged = listen("bluetooth-changed", later);
		const unlistenBattery = listen("bluetooth-battery", later);
		// The PC's battery changes slowly; once a minute keeps its time left fresh.
		const tick = window.setInterval(() => void refresh(), 60_000);
		return () => {
			if (debounce !== null) window.clearTimeout(debounce);
			window.clearInterval(tick);
			unlistenChanged.then((f) => f());
			unlistenBattery.then((f) => f());
		};
	}, [refresh]);

	const groups = useMemo(() => {
		const entries: HubEntry[] = [];
		if (pc?.present && pc.percent !== null) {
			entries.push({
				id: "pc",
				name: "This PC",
				kind: "pc",
				art: null,
				level: pc.percent,
				charging: pc.charging,
				buds: null
			});
		}
		for (const d of devices ?? []) {
			if (!d.connected) continue;
			entries.push({
				id: d.id,
				name: d.name,
				kind: d.kind,
				art: deviceLookFor(d.name) ?? deviceArtFor(d),
				level: d.battery,
				charging: false,
				buds: buds[d.id] ?? null
			});
		}
		return groupHubEntries(entries, lowThreshold);
	}, [devices, pc, buds, lowThreshold]);

	const isLow = (part: BudLevel) => !part.charging && part.level <= lowThreshold;

	const renderLevels = (entry: HubEntry) => {
		if (entry.buds) {
			const parts: [string, BudLevel][] = [];
			if (entry.buds.left) parts.push(["L", entry.buds.left]);
			if (entry.buds.right) parts.push(["R", entry.buds.right]);
			if (entry.buds.case) parts.push(["Case", entry.buds.case]);
			return (
				<div className="bh-meters">
					{parts.map(([label, part]) => (
						<Meter key={label} label={label} part={part} low={isLow(part)} />
					))}
				</div>
			);
		}
		if (entry.level === null) return <span className="bh-unknown">No battery info</span>;
		const part = { level: entry.level, charging: entry.charging };
		return (
			<div className="bh-meters">
				<Meter part={part} low={isLow(part)} />
			</div>
		);
	};

	const subText = (entry: HubEntry) => {
		if (entry.kind === "pc" && pc) return pcStatus(pc);
		if (entry.buds) return "Each bud and the case";
		return "Connected";
	};

	const loading = devices === null;
	const empty = !loading && groups.length === 0;

	return (
		<div className="qp bh" onClick={(e) => e.stopPropagation()}>
			<div className="qp-header">
				<span className="qp-row-icon bh-title-icon">
					<BatteryCharging />
				</span>
				<span className="qp-title">Battery hub</span>
			</div>
			<div className="qp-body">
				{loading ? (
					<div className="qp-empty">
						<LoaderCircle className="qp-spin" />
					</div>
				) : empty ? (
					<div className="qp-empty">
						<span>No connected devices report a battery</span>
					</div>
				) : (
					<div className="qp-list bh-list">
						{groups.map((group) => (
							<section key={group.key} className={`bh-group ${group.key}`}>
								<h3 className="bh-group-title">{group.title}</h3>
								<ul>
									{group.entries.map((entry) => (
										<li key={entry.id} className="bh-row">
											<span className="bh-art">
												{entry.art ? (
													<DeviceArt art={entry.art} phase="play" runId={0} size={30} still />
												) : (
													<Laptop />
												)}
											</span>
											<span className="qp-row-text">
												<span className="qp-row-name">{entry.name}</span>
												<span className="qp-row-sub">{subText(entry)}</span>
											</span>
											{renderLevels(entry)}
										</li>
									))}
								</ul>
							</section>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

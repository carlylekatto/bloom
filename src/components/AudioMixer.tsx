// ─── App Volume Mixer ───────────────────────────────────────────────────────
//
// Shared between the edge-hover overlay and the notch's own volume panel.
// Both surfaces used to need their own copy; the notch one was never written,
// which is why its panel only controlled master volume while the overlay's
// panel could do per-app. Keeping one implementation means a fix here reaches
// both.
//
// The backend contract is unchanged: `get_audio_sessions` already returns
// every session on the default device with its volume and mute state, and
// `set_app_volume` / `set_app_mute` write it back keyed by pid.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useMouseSliderDrag } from "../hooks/useMouseSliderDrag";
import "./AudioMixer.css";

export interface AudioSession {
	pid: number;
	name: string;
	process_path: string | null;
	volume: number;
	is_muted: boolean;
}

// Panel geometry. The expanded card grows with the number of apps (one narrow
// column each) up to a max, so a single app doesn't open a wide card.
// `MIXER_PANEL_PADDING` must match the horizontal padding on .volume-mixer-list.
const MIXER_COLUMN_WIDTH = 44;
const MIXER_COLUMN_GAP = 4;
const MIXER_PANEL_PADDING = 8;
const MIXER_MAX_COLUMNS = 4;
const MIXER_EMPTY_COLUMNS = 2;

// Last fetched session list, so reopening the mixer renders at the right width
// immediately instead of growing out of the empty-state width.
let lastKnownSessions: AudioSession[] = [];

function MixerTile({
	session,
	onVolumeChange,
	onMuteToggle,
	draggingRef
}: {
	session: AudioSession;
	onVolumeChange: (pid: number, volume: number) => void;
	onMuteToggle: (pid: number) => void;
	draggingRef: { current: number | null };
}) {
	const [icon, setIcon] = useState<string | null>(null);
	const [showPercentage, setShowPercentage] = useState(false);
	const barRef = useRef<HTMLDivElement>(null);
	const percentageTimeoutRef = useRef<any>(null);
	const lastPercentageRef = useRef<number | null>(null);

	useEffect(() => {
		if (!session.process_path) return;
		let alive = true;
		invoke<string | null>("get_app_icon", {
			path: session.process_path,
			name: session.name,
			hwnd: null
		})
			.then((data) => {
				if (alive) setIcon(data);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [session.process_path, session.name]);

	const percentage = Math.round((session.is_muted ? 0 : session.volume) * 100);

	// Flash the percentage in place of the app logo while its volume changes,
	// matching the main notch's action button.
	useEffect(() => {
		const previous = lastPercentageRef.current;
		lastPercentageRef.current = percentage;
		if (previous === null || previous === percentage) return;
		setShowPercentage(true);
		if (percentageTimeoutRef.current) clearTimeout(percentageTimeoutRef.current);
		percentageTimeoutRef.current = setTimeout(() => setShowPercentage(false), 1200);
		return () => {
			if (percentageTimeoutRef.current) clearTimeout(percentageTimeoutRef.current);
		};
	}, [percentage]);

	const volumeFromY = (clientY: number) => {
		if (!barRef.current) return;
		const rect = barRef.current.getBoundingClientRect();
		const relativeY = rect.bottom - clientY;
		onVolumeChange(session.pid, Math.max(0, Math.min(1, relativeY / rect.height)));
	};

	const startDrag = useMouseSliderDrag(volumeFromY, () => {
		draggingRef.current = null;
	});

	const handleMouseDown = (e: React.MouseEvent) => {
		startDrag(e.clientY);
		draggingRef.current = session.pid;
	};

	return (
		<div className="volume-mixer-tile">
			<div
				ref={barRef}
				className="volume-mixer-bar"
				onMouseDown={handleMouseDown}
				onTouchStart={(e) => volumeFromY(e.touches[0].clientY)}
				title={`${session.name} — ${percentage}%`}
				style={{ cursor: "pointer" }}
			>
				<motion.div
					className="volume-mixer-fill"
					initial={false}
					animate={{ height: `${percentage}%` }}
					transition={{ type: "spring", stiffness: 300, damping: 35 }}
				/>
			</div>
			<button
				className={`volume-mixer-action ${session.is_muted ? "muted" : ""} ${
					showPercentage ? "showing-percent" : ""
				}`}
				onClick={() => onMuteToggle(session.pid)}
				title={session.is_muted ? "Unmute" : "Mute"}
			>
				{icon ? (
					<img src={icon} alt="" draggable={false} />
				) : (
					<span className="volume-mixer-action-fallback">
						{session.name.charAt(0).toUpperCase()}
					</span>
				)}
				<span className="volume-mixer-action-pct">{percentage}%</span>
			</button>
		</div>
	);
}

/**
 * Per-app volume list. Render this inside the surface's own measured
 * container: App.tsx reports that container to `update_notch_rect`, so a mixer
 * that grows it is automatically added to the mouse hook's interactive region
 * by the existing ResizeObserver.
 */
export function AudioMixer({
	active,
	layout = "wrap",
	onWidthChange
}: {
	active: boolean;
	/**
	 * How the list arranges tiles once there are more apps than fit.
	 *
	 * `wrap` keeps at most four columns and stacks the rest into further rows,
	 * which suits the overlay: its panel is sized to the column count and as tall
	 * as the screen edge allows.
	 *
	 * `scroll` keeps everything on one row and scrolls sideways. The notch needs
	 * this because its dock is a fixed 112px: wrapping put a fifth app onto a
	 * second row that overlapped the first, since the two rows together exceeded
	 * the height. Cramped and wrong, not merely tight.
	 */
	layout?: "wrap" | "scroll";
	/**
	 * Reports the panel width so a host that sizes its own shell around the
	 * mixer (the overlay notch) can animate to fit. Surfaces that grow their
	 * container naturally — the notch panel — can ignore it.
	 */
	onWidthChange?: (width: number) => void;
}) {
	const draggingRef = useRef<number | null>(null);
	const [sessions, setSessions] = useState<AudioSession[]>(lastKnownSessions);
	const [sessionsLoaded, setSessionsLoaded] = useState(false);
	const [sessionsError, setSessionsError] = useState(false);

	// Panel width follows the app count (empty state keeps room for the message).
	const mixerColumns =
		sessions.length === 0 ? MIXER_EMPTY_COLUMNS : Math.min(sessions.length, MIXER_MAX_COLUMNS);
	const mixerPanelWidth =
		MIXER_PANEL_PADDING * 2 +
		mixerColumns * MIXER_COLUMN_WIDTH +
		(mixerColumns - 1) * MIXER_COLUMN_GAP;

	useEffect(() => {
		onWidthChange?.(mixerPanelWidth);
	}, [mixerPanelWidth, onWidthChange]);

	// A slider drag can end anywhere (including outside the panel); clear the
	// drag marker globally so the polling refresh stops preserving its local value.
	useEffect(() => {
		const clearDrag = () => {
			draggingRef.current = null;
		};
		window.addEventListener("pointerup", clearDrag);
		window.addEventListener("pointercancel", clearDrag);
		return () => {
			window.removeEventListener("pointerup", clearDrag);
			window.removeEventListener("pointercancel", clearDrag);
		};
	}, []);

	const refreshSessions = useCallback(() => {
		invoke<AudioSession[]>("get_audio_sessions")
			.then((list) => {
				lastKnownSessions = list;
				setSessions((prev) => {
					const prevByPid = new Map(prev.map((s) => [s.pid, s]));
					return list.map((session) => {
						if (draggingRef.current === session.pid) {
							const local = prevByPid.get(session.pid);
							if (local) {
								return { ...session, volume: local.volume, is_muted: local.is_muted };
							}
						}
						return session;
					});
				});
				setSessionsLoaded(true);
				setSessionsError(false);
			})
			.catch(() => {
				setSessionsLoaded(true);
				setSessionsError(true);
			});
	}, []);

	useEffect(() => {
		if (!active) return;
		refreshSessions();
		const interval = setInterval(refreshSessions, 2000);
		return () => clearInterval(interval);
	}, [active, refreshSessions]);

	// Slider drags fire many times per second. Coalesce into one backend call
	// per ~60ms and always flush the final value, so releasing quickly doesn't
	// leave the backend (and the next poll) snapped back to a stale volume.
	const pendingAppVolumes = useRef<Map<number, number>>(new Map());
	const appVolumeFlushRef = useRef<any>(null);

	const flushAppVolumes = useCallback(() => {
		appVolumeFlushRef.current = null;
		const pending = pendingAppVolumes.current;
		pendingAppVolumes.current = new Map();
		pending.forEach((volume, pid) => {
			invoke("set_app_volume", { pid, volume }).catch(() => {});
		});
	}, []);

	const handleAppVolumeChange = useCallback(
		(pid: number, newVol: number) => {
			setSessions((prev) =>
				prev.map((s) =>
					s.pid === pid ? { ...s, volume: newVol, is_muted: newVol === 0 ? s.is_muted : false } : s
				)
			);
			pendingAppVolumes.current.set(pid, newVol);
			if (appVolumeFlushRef.current === null) {
				appVolumeFlushRef.current = setTimeout(flushAppVolumes, 60);
			}
		},
		[flushAppVolumes]
	);

	// Send anything still queued when the panel goes away.
	useEffect(
		() => () => {
			if (appVolumeFlushRef.current !== null) {
				clearTimeout(appVolumeFlushRef.current);
				flushAppVolumes();
			}
		},
		[flushAppVolumes]
	);

	const handleAppMuteToggle = useCallback(
		(pid: number) => {
			const session = sessions.find((s) => s.pid === pid);
			const muted = !(session?.is_muted ?? false);
			setSessions((prev) => prev.map((s) => (s.pid === pid ? { ...s, is_muted: muted } : s)));
			invoke("set_app_mute", { pid, muted }).catch(() => {});
		},
		[sessions]
	);

	return (
		<div
			className="volume-mixer-host"
			style={layout === "wrap" ? { width: mixerPanelWidth } : { width: "100%" }}
			onClick={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div
				className={`volume-mixer-list${layout === "scroll" ? " volume-mixer-list-scroll" : ""}`}
				style={
					layout === "wrap" ? { gridTemplateColumns: `repeat(${mixerColumns}, 1fr)` } : undefined
				}
				onWheel={
					layout === "scroll"
						? (e) => {
								// The tiles are dragged vertically, so the wheel is free here.
								// Without this a mouse with no horizontal wheel — which is most of
								// them — could only reach a fifth app by hunting for a 4px scrollbar.
								const el = e.currentTarget;
								if (el.scrollWidth <= el.clientWidth) return;
								const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
								if (delta === 0) return;
								el.scrollLeft += delta;
								e.preventDefault();
							}
						: undefined
				}
			>
				{sessions.length === 0 ? (
					<div className="volume-mixer-empty">
						{!sessionsLoaded
							? "Loading..."
							: sessionsError
								? "Couldn't read audio sessions"
								: "No apps with audio"}
					</div>
				) : (
					sessions.map((session) => (
						<MixerTile
							key={session.pid}
							session={session}
							onVolumeChange={handleAppVolumeChange}
							onMuteToggle={handleAppMuteToggle}
							draggingRef={draggingRef}
						/>
					))
				)}
			</div>
		</div>
	);
}

/**
 * Dev-only icon comparison sheet.
 *
 * Bloom mixes three icon sources and they do not agree on weight: lucide
 * outlines, hand-written icons in `./icons`, and whatever an SVG pasted from
 * elsewhere happens to be. Judging a new one from its source is guesswork, so
 * this puts them side by side on the notch's own background at a size you can
 * type in.
 *
 * Reachable from the console as `__iconLab()`. Never mounted in a release
 * build — App.tsx gates the whole thing behind `import.meta.env.DEV`.
 */
import { useState } from "react";
import {
	ArrowUpDown,
	BellRing,
	ChevronLeft,
	ChevronRight,
	Cpu,
	File,
	HardDrive,
	Inbox,
	MemoryStick,
	Megaphone,
	RotateCcw,
	Sun,
	SunDim,
	SunMedium,
	Type,
	X,
	Music as MusicNote
} from "lucide-react";
import { GithubIcon } from "./icons/GithubIcon";
import { HeadphonesIcon } from "./icons/HeadphonesIcon";
import { MixerIcon } from "./icons/MixerIcon";
import { MusicNoteIcon } from "./icons/MusicNoteIcon";
import { PauseIcon } from "./icons/PauseIcon";
import { PlayIcon } from "./icons/PlayIcon";
import { SkipBackIcon } from "./icons/SkipBackIcon";
import { SkipForwardIcon } from "./icons/SkipForwardIcon";
import { SpeakerIcon } from "./icons/SpeakerIcon";
import { SunBrightnessIcon } from "./icons/SunBrightnessIcon";
import { VolumeHighIcon } from "./icons/VolumeHighIcon";
import { VolumeLowIcon } from "./icons/VolumeLowIcon";

/** Label, node, and whether the shape carries an `opacity` of its own. */
type Entry = { name: string; node: React.ReactNode; dim?: boolean };

function build(size: number, opacity: number): { groups: { title: string; items: Entry[] }[] } {
	const lucide = (Icon: typeof Sun, name: string): Entry => ({
		name,
		node: <Icon size={size} strokeWidth={2} />
	});

	return {
		groups: [
			{
				title: "Solid (new)",
				items: [
					{ name: "SunBrightnessIcon", node: <SunBrightnessIcon size={size} opacity={opacity} /> }
				]
			},
			{
				title: "src/icons — hand written",
				items: [
					{ name: "VolumeLowIcon", node: <VolumeLowIcon /> },
					{ name: "VolumeHighIcon", node: <VolumeHighIcon /> },
					{ name: "SpeakerIcon", node: <SpeakerIcon /> },
					{ name: "MixerIcon", node: <MixerIcon /> },
					{ name: "PlayIcon", node: <PlayIcon /> },
					{ name: "PauseIcon", node: <PauseIcon /> },
					{ name: "SkipForwardIcon", node: <SkipForwardIcon /> },
					{ name: "SkipBackIcon", node: <SkipBackIcon /> },
					{ name: "MusicNoteIcon", node: <MusicNoteIcon /> },
					{ name: "HeadphonesIcon", node: <HeadphonesIcon /> },
					{ name: "GithubIcon", node: <GithubIcon /> }
				]
			},
			{
				title: "lucide — stroked",
				items: [
					lucide(Sun, "Sun"),
					lucide(SunDim, "SunDim"),
					lucide(SunMedium, "SunMedium"),
					lucide(Cpu, "Cpu"),
					lucide(MemoryStick, "MemoryStick"),
					lucide(HardDrive, "HardDrive"),
					lucide(ArrowUpDown, "ArrowUpDown"),
					lucide(BellRing, "BellRing"),
					lucide(Megaphone, "Megaphone"),
					lucide(RotateCcw, "RotateCcw"),
					lucide(X, "X"),
					lucide(ChevronLeft, "ChevronLeft"),
					lucide(ChevronRight, "ChevronRight"),
					lucide(Inbox, "Inbox"),
					lucide(File, "File"),
					lucide(Type, "Type"),
					lucide(MusicNote, "Music")
				]
			}
		]
	};
}

export function IconLab({ onClose }: { onClose: () => void }) {
	const [size, setSize] = useState(12);
	const [opacity, setOpacity] = useState(0.45);
	const { groups } = build(size, opacity);

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 2147483647,
				background: "#0b0b14",
				color: "#f2f2f7",
				font: "12px/1.5 system-ui, sans-serif",
				padding: 20,
				overflow: "auto"
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 22 }}>
				<div style={{ fontSize: 15, fontWeight: 600 }}>Icon lab</div>

				<label style={{ display: "flex", alignItems: "center", gap: 8 }}>
					size
					<input
						type="number"
						min={6}
						max={64}
						step={1}
						value={size}
						onChange={(e) => setSize(Number(e.target.value) || 6)}
						style={{
							width: 58,
							padding: "4px 6px",
							background: "#15151f",
							color: "#fff",
							border: "1px solid #2c2c3a",
							borderRadius: 5
						}}
					/>
				</label>

				<label style={{ display: "flex", alignItems: "center", gap: 8 }}>
					opacity
					<input
						type="number"
						min={0}
						max={1}
						step={0.05}
						value={opacity}
						onChange={(e) => setOpacity(Number(e.target.value))}
						style={{
							width: 58,
							padding: "4px 6px",
							background: "#15151f",
							color: "#fff",
							border: "1px solid #2c2c3a",
							borderRadius: 5
						}}
					/>
				</label>

				<button
					onClick={onClose}
					style={{
						marginLeft: "auto",
						padding: "5px 12px",
						background: "#22222e",
						color: "#fff",
						border: "1px solid #33334a",
						borderRadius: 5,
						cursor: "pointer"
					}}
				>
					Đóng — hoặc gõ __iconLab()
				</button>
			</div>

			{groups.map((group) => (
				<div key={group.title} style={{ marginBottom: 24 }}>
					<div style={{ opacity: 0.5, marginBottom: 10, fontSize: 11 }}>{group.title}</div>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
						{group.items.map((item) => (
							<div
								key={item.name}
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "flex-end",
									gap: 8,
									width: 96,
									height: 82,
									padding: 10,
									background: "#12121c",
									border: "1px solid #23233a",
									borderRadius: 8
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										height: 34,
										color: "#e8e8f2"
									}}
								>
									{item.node}
								</div>
								<div style={{ fontSize: 10, opacity: 0.55, textAlign: "center" }}>{item.name}</div>
							</div>
						))}
					</div>
				</div>
			))}

			{/* How it actually sits in the command centre, for reference. */}
			<div style={{ opacity: 0.5, margin: "26px 0 10px", fontSize: 11 }}>
				hàng slider thật — nhãn 75px, svg bị ép 12px
			</div>
			<div
				style={{
					width: 298,
					padding: "14px 16px",
					background: "#12121c",
					borderRadius: 10,
					display: "flex",
					flexDirection: "column",
					gap: 8
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 10, height: 18 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							width: 75,
							fontSize: 9,
							fontWeight: 600
						}}
					>
						<SpeakerIcon />
						<span>Volume</span>
					</div>
					<div
						style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.14)" }}
					/>
					<div style={{ width: 28, textAlign: "right", fontSize: 9, opacity: 0.6 }}>46%</div>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 10, height: 18 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							width: 75,
							fontSize: 9,
							fontWeight: 600
						}}
					>
						<SunBrightnessIcon size={size} opacity={opacity} />
						<span>Brightness</span>
					</div>
					<div
						style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.14)" }}
					/>
					<div style={{ width: 28, textAlign: "right", fontSize: 9, opacity: 0.6 }}>100%</div>
				</div>
			</div>
		</div>
	);
}

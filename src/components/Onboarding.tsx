import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronDown,
	ChevronUp,
	Music2,
	Settings2,
	X
} from "lucide-react";
import { EdgeSurface } from "./EdgeSurface";
import { measureElements, type RegionRect } from "../windowRegion";
import {
	onboardingChoices,
	saveOnboardingChoices,
	type OnboardingChoices,
	type SurfaceMode
} from "../onboardingState";
import "./Onboarding.css";

const MODES: { value: SurfaceMode; label: string }[] = [
	{ value: "fixed", label: "Fixed" },
	{ value: "smart", label: "Smart" },
	{ value: "peek", label: "Peek" }
];
const EXPLANATIONS = {
	island: {
		fixed: "Stays visible, with your clock and quick information in reach.",
		smart: "Moves aside when a window overlaps it. Return to the top edge to reveal it.",
		peek: "Waits at the top edge. Move there to reveal it."
	},
	dock: {
		fixed: "Stays visible and reserves space beneath your windows.",
		smart: "Moves aside when a window overlaps it. Return to the bottom edge to reveal it.",
		peek: "Waits at the bottom edge. Move there to reveal it."
	}
};

function ModeChoice({
	surface,
	value,
	onChange
}: {
	surface: "island" | "dock";
	value: SurfaceMode;
	onChange: (mode: SurfaceMode) => void;
}) {
	const defaultMode = surface === "island" ? "fixed" : "smart";
	return (
		<fieldset className="onboarding-mode-group">
			<legend>
				{surface === "island" ? "The Island" : "The Dock"}
				<span>Default: {defaultMode === "fixed" ? "Fixed" : "Smart"}</span>
			</legend>
			<div className="onboarding-segments">
				{MODES.map((option) => (
					<label key={option.value} className={value === option.value ? "selected" : ""}>
						<input
							type="radio"
							name={`onboarding-${surface}`}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
						/>
						{option.label}
						{value === option.value && <Check size={12} aria-hidden="true" />}
					</label>
				))}
			</div>
			<p aria-live="polite">{EXPLANATIONS[surface][value]}</p>
		</fieldset>
	);
}

function DesktopPreview({ island, dock }: { island: SurfaceMode; dock: SurfaceMode }) {
	return (
		<div className={`onboarding-desktop island-${island} dock-${dock}`} aria-hidden="true">
			<div className="onboarding-preview-window">
				<div />
				<span />
				<span />
			</div>
			<div className="onboarding-preview-island">
				<EdgeSurface edge="top" reflective />
				<img src="/bloom.png" alt="" />
				<span>9:41</span>
				<Music2 size={13} />
			</div>
			<div className="onboarding-preview-dock">
				<EdgeSurface edge="bottom" reflective />
				<img src="/windows-11.png" alt="" />
				<span className="onboarding-folder" />
				<span className="onboarding-music">
					<Music2 size={15} />
				</span>
				<span className="onboarding-settings">
					<Settings2 size={15} />
				</span>
			</div>
			<span className="onboarding-desktop-caption">
				A little more life. Right where you need it.
			</span>
		</div>
	);
}

export function Onboarding({
	scale,
	onClose,
	onRegionChange
}: {
	scale: number;
	onClose: () => Promise<void>;
	onRegionChange: (rects: RegionRect[]) => void;
}) {
	const [step, setStep] = useState(0);
	const [choices, setChoices] = useState<OnboardingChoices | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [viewport, setViewport] = useState(() => ({ width: innerWidth, height: innerHeight }));
	const panel = useRef<HTMLElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const saving = useRef(false);
	const reducedMotion = useReducedMotion();
	const isGuide = step >= 3;
	const fitScale = Math.min(scale, (viewport.width - 40) / 720, (viewport.height - 40) / 510);
	const reportBounds = () => onRegionChange(measureElements([[".onboarding-window", 20]]));

	useEffect(() => {
		let disposed = false;
		Promise.all([invoke<Record<string, unknown>>("load_settings"), isEnabled()])
			.then(([settings, autostart]) => {
				if (!disposed) setChoices(onboardingChoices(settings, autostart));
			})
			.catch((reason) => {
				if (!disposed) setError(`Couldn't load setup: ${String(reason)}`);
			});
		const resize = () => setViewport({ width: innerWidth, height: innerHeight });
		window.addEventListener("resize", resize);
		return () => {
			disposed = true;
			window.removeEventListener("resize", resize);
		};
	}, []);

	useLayoutEffect(() => {
		heading.current?.focus();
		reportBounds();
		const frame = requestAnimationFrame(reportBounds);
		const observer = new ResizeObserver(reportBounds);
		if (panel.current) observer.observe(panel.current);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [step, viewport, fitScale]);

	const dismiss = async () => {
		if (saving.current) return;
		saving.current = true;
		setBusy(true);
		try {
			await onClose();
		} catch (reason) {
			setError(`Couldn't finish setup. Please try again. ${String(reason)}`);
		} finally {
			saving.current = false;
			setBusy(false);
		}
	};

	const save = async (tour: boolean) => {
		if (!choices || saving.current) return;
		saving.current = true;
		setBusy(true);
		setError("");
		try {
			await saveOnboardingChoices(choices, {
				saveSetting: async (key, value) => {
					await invoke("save_setting", { key, value });
					localStorage.setItem(key, value);
				},
				setAutostart: async (wanted) => {
					if ((await isEnabled()) !== wanted) await (wanted ? enable() : disable());
					await emit("autostart-changed", wanted);
				}
			});
			if (tour) setStep(3);
			else await onClose();
		} catch (reason) {
			setError(`Couldn't finish saving. Please try again. ${String(reason)}`);
		} finally {
			saving.current = false;
			setBusy(false);
		}
	};

	const titles = [
		"Your desktop is waiting.",
		"Make room for your day.",
		"Keep it blooming.",
		"Meet the Island.",
		"A taskbar that moves.",
		"Your desktop. Your rules."
	];
	const descriptions = [
		"This wakes it up.",
		"Two surfaces. Each with its own rhythm.",
		"A few small things, your way.",
		"Your music, quick controls and a moment to focus.",
		"Your apps, a little closer.",
		"Everything can change. You're in control."
	];

	return (
		<div className={`onboarding-root ${isGuide ? `onboarding-tour tour-${step}` : ""}`}>
			<motion.section
				ref={panel}
				className={`onboarding-window ${isGuide ? "is-guide" : ""}`}
				style={{ zoom: Math.max(0.5, fitScale) }}
				role="dialog"
				aria-modal="true"
				aria-labelledby="onboarding-title"
				aria-describedby="onboarding-description"
				initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				transition={{ type: "spring", stiffness: 330, damping: 32 }}
				onAnimationComplete={reportBounds}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						void dismiss();
					}
					if (event.key !== "Tab") return;
					const controls = Array.from(
						panel.current?.querySelectorAll<HTMLElement>(
							"button:not(:disabled), input:not(:disabled), [href]"
						) ?? []
					).filter((el) => el.getClientRects().length > 0);
					const first = controls[0];
					const last = controls[controls.length - 1];
					if (
						event.shiftKey &&
						(document.activeElement === first || document.activeElement === heading.current)
					) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}}
			>
				<img className="onboarding-watermark" src="/bloom.png" alt="" aria-hidden="true" />
				<header className="onboarding-header">
					<span>bloom</span>
					<button
						type="button"
						aria-label="Close setup"
						disabled={busy}
						onClick={() => void dismiss()}
					>
						<X size={17} />
					</button>
				</header>
				<div className="onboarding-content">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={step}
							initial={reducedMotion ? false : { opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
							transition={{ duration: reducedMotion ? 0 : 0.16 }}
							onAnimationComplete={() => {
								heading.current?.focus();
								reportBounds();
							}}
						>
							{isGuide && (
								<span className="onboarding-eyebrow">A quick look · {step - 2} of 3</span>
							)}
							<h1 id="onboarding-title" ref={heading} tabIndex={-1}>
								{titles[step]}
							</h1>
							<p id="onboarding-description" className="onboarding-description">
								{descriptions[step]}
							</p>
							{step === 0 && <DesktopPreview island="fixed" dock="smart" />}
							{step === 1 && choices && (
								<div className="onboarding-mode-choices">
									<ModeChoice
										surface="island"
										value={choices.island}
										onChange={(island) => setChoices({ ...choices, island })}
									/>
									<ModeChoice
										surface="dock"
										value={choices.dock}
										onChange={(dock) => setChoices({ ...choices, dock })}
									/>
								</div>
							)}
							{step === 2 && choices && (
								<div className="onboarding-preferences">
									<label>
										<span>
											Start with Windows
											<small>A familiar desktop, from the moment you sign in.</small>
										</span>
										<input
											type="checkbox"
											role="switch"
											checked={choices.autostart}
											onChange={(event) =>
												setChoices({ ...choices, autostart: event.target.checked })
											}
										/>
										<span className="onboarding-toggle" aria-hidden="true" />
									</label>
									<label>
										<span>
											Automatic updates<small>Install stable updates when they're ready.</small>
										</span>
										<input
											type="checkbox"
											role="switch"
											checked={choices.autoUpdate}
											onChange={(event) =>
												setChoices({ ...choices, autoUpdate: event.target.checked })
											}
										/>
										<span className="onboarding-toggle" aria-hidden="true" />
									</label>
									<p>You can change all of this in Settings.</p>
								</div>
							)}
							{step === 3 && (
								<div className="onboarding-guide-copy">
									<ChevronUp size={22} aria-hidden="true" />
									<p>
										Hover at the top to open it.
										<br />
										Scroll or swipe to switch panels.
									</p>
								</div>
							)}
							{step === 4 && (
								<div className="onboarding-guide-copy">
									<ChevronDown size={22} aria-hidden="true" />
									<p>
										Find your apps at the bottom edge.
										<br />
										Hover for previews. Drag to reorder.
									</p>
								</div>
							)}
							{step === 5 && (
								<div className="onboarding-guide-copy">
									<Settings2 size={22} aria-hidden="true" />
									<p>
										Right-click the Dock for Bloom Options.
										<br />
										Quit Bloom to restore your Windows taskbar.
									</p>
								</div>
							)}
						</motion.div>
					</AnimatePresence>
					{!choices && !error && (
						<p className="onboarding-status" role="status">
							Getting things ready…
						</p>
					)}
					{error && (
						<p className="onboarding-error" role="alert">
							{error}
						</p>
					)}
				</div>
				<footer className="onboarding-footer">
					<div
						className="onboarding-progress"
						aria-label={`${isGuide ? "Guide" : "Setup"} step ${isGuide ? step - 2 : step + 1} of 3`}
					>
						{[0, 1, 2].map((index) => (
							<span
								key={index}
								className={index === (isGuide ? step - 3 : step) ? "current" : ""}
							/>
						))}
					</div>
					<div className="onboarding-actions">
						{step > 0 && step !== 3 && (
							<button
								type="button"
								className="onboarding-back"
								aria-label="Previous step"
								disabled={busy}
								onClick={() => setStep(step - 1)}
							>
								<ArrowLeft size={16} />
							</button>
						)}
						{step === 2 ? (
							<>
								<button
									type="button"
									className="onboarding-link"
									disabled={busy || !choices}
									onClick={() => void save(false)}
								>
									I'll explore
								</button>
								<button
									type="button"
									className="onboarding-primary"
									disabled={busy || !choices}
									onClick={() => void save(true)}
								>
									{busy ? "Saving…" : "Show me around"}
									<ArrowRight size={15} />
								</button>
							</>
						) : (
							<>
								<button
									type="button"
									className="onboarding-link"
									disabled={busy}
									onClick={() => void dismiss()}
								>
									{isGuide ? "Skip tour" : "Set up later"}
								</button>
								<button
									type="button"
									className="onboarding-primary"
									disabled={busy || !choices}
									onClick={() => (step === 5 ? void dismiss() : setStep(step + 1))}
								>
									{step === 0 ? "Get started" : step === 5 ? "Start using Bloom" : "Continue"}
									{step !== 5 && <ArrowRight size={15} />}
								</button>
							</>
						)}
					</div>
				</footer>
			</motion.section>
		</div>
	);
}

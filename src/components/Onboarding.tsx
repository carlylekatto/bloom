import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useAnimation, useReducedMotion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
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

type TourAnchor = "center" | "island" | "dock";
const STEPS: {
	title: string;
	description: string;
	anchor: TourAnchor;
	kind: "welcome" | "intro" | "island-mode" | "dock-mode" | "controls" | "preferences" | "finish";
	hint?: string;
}[] = [
	{
		title: "Welcome to Bloom.",
		description: "Bloom makes your Windows desktop feel alive.",
		anchor: "center",
		kind: "welcome"
	},
	{
		title: "Meet the Island.",
		description:
			"That's your Island, up top. Music, quick controls and a moment to focus, all in one place.",
		anchor: "island",
		kind: "intro",
		hint: "Hover over it to open it. Scroll or swipe to switch panels."
	},
	{
		title: "Keep it in reach.",
		description: "Choose when your Island stays on screen.",
		anchor: "island",
		kind: "island-mode"
	},
	{
		title: "Meet the Dock.",
		description: "Your apps live down here now, in place of the Windows taskbar.",
		anchor: "dock",
		kind: "intro",
		hint: "Hover for window previews. Drag your apps to reorder them."
	},
	{
		title: "Give your apps some space.",
		description: "Choose when your Dock stays on screen.",
		anchor: "dock",
		kind: "dock-mode"
	},
	{
		title: "A little less interruption.",
		description: "Bloom brings volume and brightness controls to the sides of your screen.",
		anchor: "center",
		kind: "controls",
		hint: "Use your keyboard controls as usual. Edge hover is available in Settings."
	},
	{
		title: "Make yourself at home.",
		description: "Two small choices before you go.",
		anchor: "center",
		kind: "preferences"
	},
	{
		title: "Already blooming.",
		description: "Bloom is already working. Go on, try it out.",
		anchor: "center",
		kind: "finish",
		hint: "Right-click the Dock for Bloom Options. Quit Bloom to bring back your Windows taskbar."
	}
];
const CARD_WIDTH = 500;
const CARD_HEIGHT = 400;

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
	const navigation = useRef(0);
	const alive = useRef(true);
	const initialized = useRef(false);
	const reducedMotion = useReducedMotion();
	const shell = useAnimation();
	const content = useAnimation();
	const page = STEPS[step];
	const fitScale = Math.max(
		0.4,
		Math.min(scale, (viewport.width - 40) / CARD_WIDTH, (viewport.height - 160) / CARD_HEIGHT)
	);
	const width = CARD_WIDTH * fitScale;
	const height = CARD_HEIGHT * fitScale;
	const x = (viewport.width - width) / 2;
	const edgeGap = Math.min(96 * fitScale, (viewport.height - height) / 2);
	const y =
		page.anchor === "island"
			? edgeGap
			: page.anchor === "dock"
				? viewport.height - height - edgeGap
				: (viewport.height - height) / 2;
	const reportBounds = () => onRegionChange(measureElements([[".onboarding-window", 20]]));

	useEffect(() => {
		alive.current = true;
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
			alive.current = false;
			disposed = true;
			navigation.current++;
			window.removeEventListener("resize", resize);
			void emit("onboarding-surface", "none").catch(console.error);
		};
	}, []);

	useLayoutEffect(() => {
		const generation = navigation.current;
		// Admit the whole travel path before moving, so the native region cannot
		// clip the card while IPC catches up. Tighten it again once settled.
		const current = measureElements([[".onboarding-window", 20]])[0];
		const left = Math.min(current?.x ?? x - 20, x - 20);
		const top = Math.min(current?.y ?? y - 20, y - 20);
		onRegionChange([
			{
				x: left,
				y: top,
				width:
					Math.max(current ? current.x + current.width : x + width + 20, x + width + 20) - left,
				height:
					Math.max(current ? current.y + current.height : y + height + 20, y + height + 20) - top
			}
		]);
		// A fixed-size card moves with a transform; text never scales or reflows.
		if (!initialized.current || reducedMotion) {
			shell.set({ x, y, opacity: 1 });
			initialized.current = true;
		} else {
			void shell.start({
				x,
				y,
				opacity: 1,
				transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] }
			});
		}
		void content
			.start({
				opacity: 1,
				transition: { duration: reducedMotion ? 0 : 0.16, delay: reducedMotion ? 0 : 0.12 }
			})
			.then(() => {
				if (alive.current && generation === navigation.current)
					heading.current?.focus({ preventScroll: true });
			});
		if (reducedMotion) reportBounds();
	}, [step, x, y, reducedMotion, shell, content]);

	useEffect(() => {
		// Reveal the actual surface during its introduction, without changing its mode.
		void emit("onboarding-surface", page.anchor).catch(console.error);
	}, [page.anchor]);

	const navigate = async (next: number) => {
		if (saving.current || next < 0 || next >= STEPS.length) return;
		const generation = ++navigation.current;
		await content.start({ opacity: 0, transition: { duration: reducedMotion ? 0 : 0.1 } });
		if (alive.current && generation === navigation.current) {
			setError("");
			setStep(next);
		}
	};

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

	const save = async () => {
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
			saving.current = false;
			await navigate(step + 1);
		} catch (reason) {
			setError(`Couldn't finish saving. Please try again. ${String(reason)}`);
		} finally {
			saving.current = false;
			setBusy(false);
		}
	};

	return (
		<div className="onboarding-root">
			<motion.section
				ref={panel}
				className="onboarding-window"
				style={{ width, height }}
				role="dialog"
				aria-labelledby="onboarding-title"
				aria-describedby="onboarding-description"
				initial={{ x, y, opacity: 0 }}
				animate={shell}
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
				<div className="onboarding-card" style={{ zoom: fitScale }}>
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
					<motion.div
						className={`onboarding-page ${page.kind === "welcome" || page.kind === "finish" ? "is-welcome" : ""}`}
						initial={{ opacity: 0 }}
						animate={content}
					>
						<div className="onboarding-content">
							<h1 id="onboarding-title" ref={heading} tabIndex={-1}>
								{page.title}
							</h1>
							<p id="onboarding-description" className="onboarding-description">
								{page.description}
							</p>
							{page.hint && <p className="onboarding-hint">{page.hint}</p>}
							{choices && (page.kind === "island-mode" || page.kind === "dock-mode") && (
								<div className="onboarding-mode-choices">
									<ModeChoice
										surface={page.kind === "island-mode" ? "island" : "dock"}
										value={page.kind === "island-mode" ? choices.island : choices.dock}
										onChange={(value) =>
											setChoices({
												...choices,
												[page.kind === "island-mode" ? "island" : "dock"]: value
											})
										}
									/>
								</div>
							)}
							{page.kind === "preferences" && choices && (
								<div className="onboarding-preferences">
									<label>
										<span>
											Start with Windows<small>Ready when you sign in.</small>
										</span>
										<input
											type="checkbox"
											role="switch"
											disabled={busy}
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
											disabled={busy}
											checked={choices.autoUpdate}
											onChange={(event) =>
												setChoices({ ...choices, autoUpdate: event.target.checked })
											}
										/>
										<span className="onboarding-toggle" aria-hidden="true" />
									</label>
								</div>
							)}
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
							<span
								className="onboarding-progress"
								aria-label={`Step ${step + 1} of ${STEPS.length}`}
							>
								{step + 1} / {STEPS.length}
							</span>
							<div className="onboarding-actions">
								{step > 0 && (
									<button
										type="button"
										className="onboarding-back"
										aria-label="Previous step"
										disabled={busy}
										onClick={() => void navigate(step - 1)}
									>
										<ArrowLeft size={16} />
									</button>
								)}
								{page.kind !== "finish" && (
									<button
										type="button"
										className="onboarding-link"
										disabled={busy}
										onClick={() => void dismiss()}
									>
										Skip
									</button>
								)}
								<button
									type="button"
									className="onboarding-primary"
									disabled={busy || !choices}
									onClick={() => {
										if (page.kind === "finish") void dismiss();
										else if (page.kind === "preferences") void save();
										else void navigate(step + 1);
									}}
								>
									{busy
										? "Saving…"
										: page.kind === "welcome"
											? "Show me around"
											: page.kind === "finish"
												? "Let's bloom"
												: "Continue"}
									{page.kind !== "finish" && <ArrowRight size={15} />}
								</button>
							</div>
						</footer>
					</motion.div>
				</div>
			</motion.section>
		</div>
	);
}

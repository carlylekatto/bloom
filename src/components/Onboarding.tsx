import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useAnimation, useReducedMotion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { measureElements, type RegionRect } from "../windowRegion";
import { hexToHsl } from "../theme";
import {
	onboardingChoices,
	saveOnboardingChoice,
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
		smart: "Moves aside when a window overlaps it.\nReturn to the top edge to reveal it.",
		peek: "Waits at the top edge.\nMove there to reveal it."
	},
	dock: {
		fixed: "Stays visible and reserves space beneath your windows.",
		smart: "Moves aside when a window overlaps it.\nReturn to the bottom edge to reveal it.",
		peek: "Waits at the bottom edge.\nMove there to reveal it."
	}
};

function ModeChoice({
	surface,
	value,
	disabled,
	onChange
}: {
	surface: "island" | "dock";
	value: SurfaceMode;
	disabled: boolean;
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
							disabled={disabled}
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
	hints?: string[];
}[] = [
	{
		title: "Welcome to Bloom.",
		description: "Bloom makes your Windows desktop feel alive.",
		anchor: "center",
		kind: "welcome"
	},
	{
		title: "Meet the Island.",
		description: "Music, widgets and quick controls, together at the top of your screen.",
		anchor: "island",
		kind: "intro",
		hints: [
			"Hover to reveal widgets.",
			"While hovering, click, swipe or scroll to open and switch modes.",
			"Find quick controls and Settings in Command Center."
		]
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
		hints: ["Hover for window previews.", "Drag your apps to reorder them."]
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
		hints: ["Use your keyboard controls as usual.", "Enable edge hover in Settings."]
	},
	{
		title: "Make yourself at home.",
		description: "A few small choices, your way.",
		anchor: "center",
		kind: "preferences"
	},
	{
		title: "Already blooming.",
		description: "Bloom is already working. Go on, try it out.",
		anchor: "center",
		kind: "finish",
		hints: [
			"Open Settings from Command Center.",
			"Or right-click the Dock for Bloom Options.",
			"Quit Bloom to restore the Windows taskbar."
		]
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
	const [themeMode, setThemeMode] = useState("dark");
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
	const reportBounds = () =>
		onRegionChange(
			measureElements([
				[".onboarding-window", 20],
				[".onboarding-arrow", 4]
			])
		);

	useEffect(() => {
		alive.current = true;
		let disposed = false;
		Promise.all([invoke<Record<string, unknown>>("load_settings"), isEnabled()])
			.then(([settings, autostart]) => {
				if (!disposed) {
					setChoices(onboardingChoices(settings, autostart));
					const theme = settings["bloom-theme-mode"];
					setThemeMode(
						typeof theme === "string" && ["dark", "light", "custom", "adaptive"].includes(theme)
							? theme
							: "dark"
					);
				}
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
		const arrowRoom = page.anchor === "center" ? 0 : 60 * fitScale;
		const top = Math.min(current?.y ?? y - 20, y - 20) - arrowRoom;
		onRegionChange([
			{
				x: left,
				y: top,
				width:
					Math.max(current ? current.x + current.width : x + width + 20, x + width + 20) - left,
				height:
					Math.max(current ? current.y + current.height : y + height + 20, y + height + 20) +
					arrowRoom -
					top
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
		void emit("onboarding-surface", page.kind === "intro" ? page.anchor : "none").catch(
			console.error
		);
	}, [page.anchor, page.kind]);

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

	const changeAppearance = async (value: string) => {
		if (saving.current) return;
		saving.current = true;
		setBusy(true);
		setError("");
		try {
			if (value === "adaptive") {
				const accent = await invoke<string>("get_system_accent_color");
				const hsl = hexToHsl(accent);
				for (const [key, setting] of [
					["bloom-theme-saturation", String(hsl.s / 100)],
					["bloom-theme-brightness", String(hsl.l / 100)]
				]) {
					await invoke("save_setting", { key, value: setting });
					localStorage.setItem(key, setting);
				}
			}
			await invoke("save_setting", { key: "bloom-theme-mode", value });
			setThemeMode(value);
			localStorage.setItem("bloom-theme-mode", value);
		} catch (reason) {
			setError(`Couldn't change appearance. Please try again. ${String(reason)}`);
		} finally {
			saving.current = false;
			setBusy(false);
		}
	};

	const changeChoice = async <K extends keyof OnboardingChoices>(
		key: K,
		value: OnboardingChoices[K]
	) => {
		if (!choices || saving.current) return;
		saving.current = true;
		setBusy(true);
		setError("");
		try {
			await saveOnboardingChoice(key, value, {
				saveSetting: async (key, value) => {
					await invoke("save_setting", { key, value });
					localStorage.setItem(key, value);
				},
				setAutostart: async (wanted) => {
					if ((await isEnabled()) !== wanted) await (wanted ? enable() : disable());
					await emit("autostart-changed", wanted);
				}
			});
			setChoices((current) => (current ? { ...current, [key]: value } : current));
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
							"button:not(:disabled), input:not(:disabled), select:not(:disabled), [href]"
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
					<div className="onboarding-watermark-clip" aria-hidden="true">
						<img className="onboarding-watermark" src="/bloom.png" alt="" />
					</div>
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
						{page.anchor !== "center" && (
							<svg
								key={step}
								className={`onboarding-arrow ${edgeGap / fitScale >= 88 ? "is-outside" : "is-inside"} ${page.anchor === "dock" ? "points-down" : "points-up"}`}
								viewBox="0 0 112 56"
								fill="none"
								aria-hidden="true"
								focusable="false"
							>
								<motion.path
									d="M104 48 C107 28 80 23 59 24 S23 23 9 7"
									initial={reducedMotion ? false : { pathLength: 0 }}
									animate={{ pathLength: 1 }}
									transition={{
										duration: reducedMotion ? 0 : 0.22,
										delay: reducedMotion ? 0 : 0.08,
										ease: "easeInOut"
									}}
								/>
								<motion.path
									d="M10 20 L9 7 L22 8"
									initial={reducedMotion ? false : { pathLength: 0 }}
									animate={{ pathLength: 1 }}
									transition={{
										duration: reducedMotion ? 0 : 0.08,
										delay: reducedMotion ? 0 : 0.3,
										ease: "easeOut"
									}}
								/>
							</svg>
						)}
						<div className="onboarding-content">
							<h1 id="onboarding-title" ref={heading} tabIndex={-1}>
								{page.title}
							</h1>
							<p id="onboarding-description" className="onboarding-description">
								{page.description}
							</p>
							{page.hints && (
								<div className="onboarding-hint">
									{page.hints.map((hint) => (
										<p key={hint}>{hint}</p>
									))}
								</div>
							)}
							{choices && (page.kind === "island-mode" || page.kind === "dock-mode") && (
								<div className="onboarding-mode-choices">
									<ModeChoice
										surface={page.kind === "island-mode" ? "island" : "dock"}
										value={page.kind === "island-mode" ? choices.island : choices.dock}
										disabled={busy}
										onChange={(value) =>
											void changeChoice(page.kind === "island-mode" ? "island" : "dock", value)
										}
									/>
								</div>
							)}
							{page.kind === "preferences" && choices && (
								<div className="onboarding-preferences">
									<label htmlFor="onboarding-appearance">
										<span>Appearance</span>
										<select
											id="onboarding-appearance"
											value={themeMode}
											disabled={busy}
											onChange={(event) => void changeAppearance(event.target.value)}
										>
											<option value="dark">Dark</option>
											<option value="light">Light</option>
											{themeMode === "custom" && <option value="custom">Custom (current)</option>}
											<option value="adaptive">Adaptive Color</option>
										</select>
									</label>
									<label>
										<span>Start with Windows</span>
										<input
											type="checkbox"
											role="switch"
											disabled={busy}
											checked={choices.autostart}
											onChange={(event) => void changeChoice("autostart", event.target.checked)}
										/>
										<span className="onboarding-toggle" aria-hidden="true" />
									</label>
									<label>
										<span>Automatic updates</span>
										<input
											type="checkbox"
											role="switch"
											disabled={busy}
											checked={choices.autoUpdate}
											onChange={(event) => void changeChoice("autoUpdate", event.target.checked)}
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

import { useLayoutEffect, useRef } from "react";
import { edgeSurfaceContour } from "./edgeSurfaceContour";
import "./EdgeSurface.css";

type Edge = "top" | "bottom" | "left" | "right";

interface EdgeSurfaceProps {
	/** The screen edge the surface hangs from. */
	edge: Edge;
	/** Show the concave flares that bridge the pill to the edge. */
	flares?: boolean;
	/** Draw one continuous reflective contour around the surface. */
	reflective?: boolean;
	/** UI zoom/scale, in addition to the monitor's device pixel ratio. */
	resolutionScale?: number;
}

/** The fill and flares remain CSS; only the reflective contour is rasterized. */
export function EdgeSurface({
	edge,
	flares = true,
	reflective = false,
	resolutionScale = 1
}: EdgeSurfaceProps) {
	const surfaceRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const invalidationRef = useRef<HTMLSpanElement>(null);

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		const parent = surface?.parentElement;
		const canvas = canvasRef.current;
		const invalidation = invalidationRef.current;
		if (
			!reflective ||
			!surface ||
			!parent ||
			!canvas ||
			!invalidation ||
			(edge !== "top" && edge !== "bottom")
		)
			return;
		const context = canvas.getContext("2d");
		if (!context) return;
		let width = 0;
		let height = 0;
		let previousGeometry = "";
		let paletteDirty = true;
		let colors = ["", "", ""];
		let invalidationPending = false;
		const radiusStyleKey = () =>
			[
				parent.style.borderTopLeftRadius,
				parent.style.borderTopRightRadius,
				parent.style.borderBottomLeftRadius,
				parent.style.borderBottomRightRadius
			].join(",");
		let previousRadiusStyle = radiusStyleKey();
		let previousClass = parent.className;

		const draw = () => {
			if (!(width > 26 && height > 0)) return;
			const style = getComputedStyle(parent);
			const radii = [
				style.borderTopLeftRadius,
				style.borderTopRightRadius,
				style.borderBottomLeftRadius,
				style.borderBottomRightRadius
			].map((value) => parseFloat(value) || 0);
			if (paletteDirty) {
				const surfaceStyle = getComputedStyle(surface);
				colors = ["--surface-line", "--surface-side-light", "--surface-highlight"].map((property) =>
					surfaceStyle.getPropertyValue(property).trim()
				);
				paletteDirty = false;
			}
			const ratio = window.devicePixelRatio * Math.max(1, resolutionScale);
			const pathData = edgeSurfaceContour(width, height, radii, edge, flares);
			const geometry = [pathData, ratio, ...colors].join("|");
			if (geometry === previousGeometry) return;
			previousGeometry = geometry;

			// Retain backing capacity across spring frames and mode changes.
			// Reallocating at every fractional resize clears the bitmap each time.
			const neededWidth = Math.ceil((width * ratio) / 64) * 64;
			const neededHeight = Math.ceil((height * ratio) / 64) * 64;
			if (canvas.width < neededWidth) canvas.width = neededWidth;
			if (canvas.height < neededHeight) canvas.height = neededHeight;
			canvas.style.width = `${canvas.width / ratio}px`;
			canvas.style.height = `${canvas.height / ratio}px`;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.save();
			if (edge === "bottom") {
				context.translate(0, height);
				context.scale(1, -1);
			}
			const path = new Path2D(pathData);
			const light = context.createLinearGradient(0, 0, 0, height);
			light.addColorStop(0, colors[0]);
			light.addColorStop(0.45, colors[1]);
			light.addColorStop(1, colors[2]);
			context.clip(path);
			context.strokeStyle = light;
			context.lineWidth = 4;
			context.globalAlpha = 0.16;
			context.stroke(path);
			context.lineWidth = 2;
			context.globalAlpha = 1;
			context.stroke(path);
			context.restore();
			if (flares) {
				const fade = context.createLinearGradient(0, 0, width, 0);
				fade.addColorStop(0, "transparent");
				fade.addColorStop(13 / width, "white");
				fade.addColorStop(1 - 13 / width, "white");
				fade.addColorStop(1, "transparent");
				context.save();
				context.globalCompositeOperation = "destination-in";
				context.fillStyle = fade;
				context.fillRect(0, 0, width, height);
				context.restore();
			}
		};

		// Both kinds of geometry changes are drawn after layout, before paint.
		// Translation and opacity changes skip all measurements and drawing.
		const resize = new ResizeObserver((entries) => {
			invalidationPending = false;
			for (const entry of entries) {
				if (entry.target !== surface) continue;
				width = entry.contentRect.width;
				height = entry.contentRect.height;
			}
			draw();
		});
		const invalidate = () => {
			if (invalidationPending) return;
			invalidationPending = true;
			invalidation.style.width = invalidation.style.width === "1px" ? "0px" : "1px";
		};
		resize.observe(surface);
		resize.observe(invalidation);
		const mutations = new MutationObserver(() => {
			const nextRadiusStyle = radiusStyleKey();
			const nextClass = parent.className;
			if (nextRadiusStyle === previousRadiusStyle && nextClass === previousClass) return;
			paletteDirty ||= nextClass !== previousClass;
			previousRadiusStyle = nextRadiusStyle;
			previousClass = nextClass;
			invalidate();
		});
		mutations.observe(parent, { attributes: true, attributeFilter: ["style", "class"] });
		const theme = new MutationObserver(() => {
			paletteDirty = true;
			invalidate();
		});
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["style", "class"]
		});
		// The notch interpolates its registered background colour on hover.
		// Sample the matching rim colours during that short CSS transition too,
		// even when its dimensions have already stopped changing.
		let paletteFrame = 0;
		let paletteTransitionActive = false;
		const updatePalette = () => {
			paletteFrame = 0;
			paletteDirty = true;
			invalidate();
			if (paletteTransitionActive) paletteFrame = requestAnimationFrame(updatePalette);
		};
		const onTransitionRun = (event: TransitionEvent) => {
			if (event.target !== parent || event.propertyName !== "--notch-bg") return;
			paletteTransitionActive = true;
			if (!paletteFrame) paletteFrame = requestAnimationFrame(updatePalette);
		};
		const onTransitionEnd = (event: TransitionEvent) => {
			if (event.target !== parent || event.propertyName !== "--notch-bg") return;
			paletteTransitionActive = false;
			paletteDirty = true;
			invalidate();
		};
		parent.addEventListener("transitionrun", onTransitionRun);
		parent.addEventListener("transitionend", onTransitionEnd);
		parent.addEventListener("transitioncancel", onTransitionEnd);
		window.addEventListener("resize", invalidate);
		return () => {
			resize.disconnect();
			mutations.disconnect();
			theme.disconnect();
			cancelAnimationFrame(paletteFrame);
			parent.removeEventListener("transitionrun", onTransitionRun);
			parent.removeEventListener("transitionend", onTransitionEnd);
			parent.removeEventListener("transitioncancel", onTransitionEnd);
			window.removeEventListener("resize", invalidate);
		};
	}, [edge, flares, reflective, resolutionScale]);

	return (
		<div
			ref={surfaceRef}
			className={`edge-surface edge-surface--${edge}${flares ? " show-flares" : ""}`}
			aria-hidden="true"
		>
			<span className="edge-surface-flare edge-surface-flare--start" />
			<span className="edge-surface-flare edge-surface-flare--end" />
			{reflective && (
				<>
					<span ref={invalidationRef} className="edge-surface-invalidation" />
					<canvas ref={canvasRef} className="edge-surface-rim" />
				</>
			)}
		</div>
	);
}

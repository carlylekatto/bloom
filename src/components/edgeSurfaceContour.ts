export type CornerRadius = readonly [number, number];

/** Computed radii can be elliptical percentages during Motion layout projection. */
export function resolveCornerRadius(value: string, width: number, height: number): CornerRadius {
	const [horizontal = "0", vertical = horizontal] = value.trim().split(/\s+/);
	const pixels = (part: string, size: number) =>
		Math.max(0, parseFloat(part) || 0) * (part.endsWith("%") ? size / 100 : 1);
	return [pixels(horizontal, width), pixels(vertical, height)];
}

/** SVG contour, also accepted verbatim by Canvas Path2D, in untransformed pixels. */
export function edgeSurfaceContour(
	width: number,
	height: number,
	radii: readonly CornerRadius[],
	edge: "top" | "bottom",
	flares: boolean
): string {
	const bottom = edge === "bottom";
	const left = 13;
	const right = width - 13;
	const radius = ([x, y]: CornerRadius): CornerRadius => [
		Math.min(x, (right - left) / 2),
		Math.min(y, height / 2)
	];
	const rl = radius(radii[bottom ? 0 : 2]);
	const rr = radius(radii[bottom ? 1 : 3]);
	const backLeft = radius(radii[2]);
	const backRight = radius(radii[3]);
	if (bottom && !flares && (backLeft.some((r) => r > 0) || backRight.some((r) => r > 0))) {
		return (
			`M ${left} ${backLeft[1]} A ${backLeft[0]} ${backLeft[1]} 0 0 1 ${left + backLeft[0]} 0 L ${right - backRight[0]} 0 A ${backRight[0]} ${backRight[1]} 0 0 1 ${right} ${backRight[1]}` +
			` L ${right} ${height - rr[1]} A ${rr[0]} ${rr[1]} 0 0 1 ${right - rr[0]} ${height} L ${left + rl[0]} ${height} A ${rl[0]} ${rl[1]} 0 0 1 ${left} ${height - rl[1]} Z`
		);
	}
	let path = flares ? "M 0 0 C 10 0 13 3 13 13" : `M ${left} 0`;
	path += ` L ${left} ${height - rl[1]} A ${rl[0]} ${rl[1]} 0 0 0 ${left + rl[0]} ${height}`;
	path += ` L ${right - rr[0]} ${height} A ${rr[0]} ${rr[1]} 0 0 0 ${right} ${height - rr[1]}`;
	path += flares ? ` L ${right} 13 C ${right} 3 ${width - 10} 0 ${width} 0` : ` L ${right} 0`;
	return path;
}

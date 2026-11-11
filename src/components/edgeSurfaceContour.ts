/** The original SVG contour, also accepted verbatim by Canvas Path2D. */
export function edgeSurfaceContour(
	width: number,
	height: number,
	radii: number[],
	edge: "top" | "bottom",
	flares: boolean
): string {
	const bottom = edge === "bottom";
	const left = 13;
	const right = width - 13;
	const radius = (value: number) => Math.min(value, height / 2, (right - left) / 2);
	const rl = radius(radii[bottom ? 0 : 2]);
	const rr = radius(radii[bottom ? 1 : 3]);
	const backLeft = radius(radii[2]);
	const backRight = radius(radii[3]);
	if (bottom && !flares && (backLeft > 0 || backRight > 0)) {
		return (
			`M ${left} ${backLeft} A ${backLeft} ${backLeft} 0 0 1 ${left + backLeft} 0 L ${right - backRight} 0 A ${backRight} ${backRight} 0 0 1 ${right} ${backRight}` +
			` L ${right} ${height - rr} A ${rr} ${rr} 0 0 1 ${right - rr} ${height} L ${left + rl} ${height} A ${rl} ${rl} 0 0 1 ${left} ${height - rl} Z`
		);
	}
	let path = flares ? "M 0 0 C 10 0 13 3 13 13" : `M ${left} 0`;
	path += ` L ${left} ${height - rl} A ${rl} ${rl} 0 0 0 ${left + rl} ${height}`;
	path += ` L ${right - rr} ${height} A ${rr} ${rr} 0 0 0 ${right} ${height - rr}`;
	path += flares ? ` L ${right} 13 C ${right} 3 ${width - 10} 0 ${width} 0` : ` L ${right} 0`;
	return path;
}

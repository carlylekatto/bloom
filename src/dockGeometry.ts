// The expanded content stays mounted while the animated bar shrinks to its
// hidden pill. Use its natural width, not the live hit area or preview padding.
export function dockOverlapSpan(
	viewportWidth: number,
	contentWidth: number,
	horizontalPadding: number,
	scale: number
) {
	const width = Math.round((contentWidth + horizontalPadding) * scale);
	return { x: Math.round((viewportWidth - width) / 2), width };
}

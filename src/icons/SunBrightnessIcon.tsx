/**
 * A filled Material sun, which reads as a brightness control at row size where
 * an outline one can be mistaken for a plain dot.
 *
 * Kept in its own file rather than inline in App.tsx so the icon lab can render
 * the same component the app does, rather than a copy that can drift.
 */

/** Neighbouring icons in `.cc-classic-slider-label` render at this size. */
const NEIGHBOUR_SIZE = 12;

/**
 * How much of the box this sun leaves empty on each side, in pixels.
 *
 * Its viewBox is 672 square but the rays only span x 42..630, so 42/672 = 6.25%
 * of the box is blank gutter at both ends. The neighbouring icons do not have
 * this: `VolumeLowIcon` is a 22.49 x 21.94 viewBox, which `xMidYMid meet`
 * scales to fill all 12px of its width, putting its ink hard against the left
 * edge. Left alone, this sun's ink starts about a pixel further right, which is
 * what made the whole label look misaligned.
 */
function inkGutter(size: number): number {
	return (size * 42) / 672;
}

export function SunBrightnessIcon({
	size = 12,
	opacity = 0.45,
	lift = 1
}: {
	size?: number;
	opacity?: number;
	/** Nudges the icon up relative to the label text. A solid glyph this size
	 *  reads as sitting low next to 9px type; 1px is enough. */
	lift?: number;
}) {
	// Pull the icon left by its own gutter so its ink lines up with the
	// neighbours'.
	const gutter = inkGutter(size);
	// The label's text sits after the icon and the gap, so it inherits the full
	// width difference: a wider icon pushes the text right. Give back
	// `size - NEIGHBOUR_SIZE` on the right, minus what we just took on the left,
	// and the text lands where the neighbours' text does.
	const rightMargin = -(size - NEIGHBOUR_SIZE) + gutter;
	// If this ever drops to the neighbour size there is nothing to correct.
	const nudge =
		size === NEIGHBOUR_SIZE
			? { marginLeft: 0, marginRight: 0 }
			: {
					marginLeft: -gutter,
					marginRight: rightMargin
				};

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			viewBox="0 0 672 672"
			// The label's stylesheet forces `opacity: 0.7` on every svg inside it,
			// which suits a stroked icon. This one is solid, so it reads heavier
			// than its neighbours unless it is turned down here.
			// Inline width/height beat the stylesheet's 12px.
			style={{ opacity, width: size, height: size, marginTop: -lift, ...nudge }}
		>
			<path
				fill="currentColor"
				d="M252 336C252 307.8 260.8 287.4 274.1 274.1C287.4 260.8 307.8 252 336 252C364.2 252 384.6 260.8 397.9 274.1C411.2 287.4 420 307.8 420 336C420 364.2 411.2 384.6 397.9 397.9C384.6 411.2 364.2 420 336 420C307.8 420 287.4 411.2 274.1 397.9C260.8 384.6 252 364.2 252 336zM307.9 50.2C316.6 44.6 326.4 42 336 42C345.6 42 355.5 44.6 364.1 50.2C385 63.7 404.5 79.6 422.1 96C428.3 101.8 436.3 105.1 444.8 105.4C468.8 106.3 493.8 108.8 518.2 114C528.3 116.2 537.1 121.3 543.9 128.1C550.7 134.9 555.8 143.8 558 153.8C563.2 178.1 565.7 203.1 566.6 227.2C566.9 235.6 570.2 243.7 576 249.9C592.4 267.5 608.3 287 621.8 307.8C627.4 316.5 630 326.3 630 335.9C630 345.5 627.4 355.4 621.8 364C608.3 384.9 592.4 404.4 576 422C570.2 428.2 566.9 436.2 566.6 444.7C565.7 468.7 563.2 493.7 558 518.1C555.8 528.2 550.7 537 543.9 543.8C537.1 550.6 528.3 555.7 518.2 557.9C493.9 563.1 468.9 565.6 444.8 566.5C436.4 566.8 428.3 570.1 422.1 575.9C404.5 592.3 385 608.2 364.1 621.7C355.4 627.3 345.6 629.9 336 629.9C326.4 629.9 316.5 627.3 307.9 621.7C287 608.2 267.5 592.3 250 575.9C243.8 570.1 235.8 566.8 227.3 566.5C203.3 565.6 178.3 563.1 153.9 557.9C143.8 555.7 135 550.6 128.2 543.8C121.4 537 116.2 528.2 114 518.2C108.8 493.9 106.3 468.9 105.4 444.8C105.1 436.4 101.8 428.3 96 422.1C79.6 404.5 63.7 385 50.2 364.1C44.6 355.4 42 345.6 42 336C42 326.4 44.6 316.5 50.2 307.9C63.7 287 79.6 267.5 96 250C101.8 243.8 105.1 235.8 105.4 227.3C106.3 203.3 108.8 178.3 114 153.9C116.2 143.8 121.3 135 128.1 128.2C134.9 121.4 143.8 116.2 153.8 114C178.1 108.8 203.1 106.3 227.2 105.4C235.6 105.1 243.7 101.8 249.9 96C267.5 79.6 287 63.7 307.8 50.2zM336 196C295.7 196 260.1 208.9 234.5 234.5C208.9 260.1 196 295.7 196 336C196 376.3 208.9 411.9 234.5 437.5C260.1 463.1 295.7 476 336 476C376.3 476 411.9 463.1 437.5 437.5C463.1 411.9 476 376.3 476 336C476 295.7 463.1 260.1 437.5 234.5C411.9 208.9 376.3 196 336 196z"
			/>
		</svg>
	);
}

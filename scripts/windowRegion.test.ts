import { describe, expect, test } from "bun:test";
import {
	clipToWindow,
	createRegionSender,
	nextRegion,
	notchPillBox,
	padRect,
	type RegionState
} from "../src/windowRegion";

const empty: RegionState = { key: "", current: [], held: [] };

describe("window region", () => {
	test("pads and clips rectangles to whole pixels inside the window", () => {
		expect(padRect({ x: 10, y: 10, width: 20, height: 20 }, 5)).toEqual({
			x: 5,
			y: 5,
			width: 30,
			height: 30
		});
		expect(clipToWindow({ x: -4.5, y: -10, width: 20.2, height: 30 }, 100, 100)).toEqual({
			x: 0,
			y: 0,
			width: 16,
			height: 20
		});
		// A notch hidden above the window has nothing left to clip to.
		expect(clipToWindow({ x: 10, y: -100, width: 50, height: 60 }, 100, 100)).toBeNull();
	});

	test("centers the pill box and pads its sides and bottom", () => {
		// 140x44 pill at scale 1 in a 1440px window, 24px padding.
		expect(notchPillBox(1440, 1, 0, 140, 44, 24)).toEqual({
			x: 626,
			y: 0,
			width: 188,
			height: 68
		});
		// Scale applies to the pill and the padding alike.
		expect(notchPillBox(1440, 2, 0, 140, 44, 24)).toEqual({
			x: 532,
			y: 0,
			width: 376,
			height: 136
		});
	});

	test("grows at once, and holds the old region while shrinking", () => {
		const small = [{ x: 600, y: 0, width: 200, height: 60 }];
		const big = [{ x: 500, y: 0, width: 400, height: 300 }];

		const first = nextRegion(empty, small, 0, 700);
		expect(first.changed).toBe(true);
		expect(first.rects).toEqual(small);

		// Growing: the new region is sent right away (old one held, but it's inside).
		const grown = nextRegion(first.state, big, 100, 700);
		expect(grown.changed).toBe(true);
		expect(grown.rects).toEqual([...big, ...small]);

		// Shrinking back: the big region is held until 300 + 700 (the small
		// one held while growing is still there too, until 100 + 700).
		const shrinking = nextRegion(grown.state, small, 300, 700);
		expect(shrinking.rects).toEqual([...small, ...small, ...big]);
		expect(shrinking.nextExpiry).toBe(800);

		// After the hold runs out only the small region is left.
		const settled = nextRegion(shrinking.state, small, 1001, 700);
		expect(settled.rects).toEqual(small);
		expect(settled.changed).toBe(true);
		expect(settled.nextExpiry).toBeNull();
	});

	test("the sender clips to the window and sends only changes", () => {
		// The display scale's media query, fired by hand below.
		let scaleChanged = () => {};
		const fakeWindow = {
			innerWidth: 1000,
			innerHeight: 500,
			devicePixelRatio: 1,
			matchMedia: () => ({
				addEventListener: (_: string, listener: () => void) => {
					scaleChanged = listener;
				},
				removeEventListener: () => {}
			})
		};
		(globalThis as { window?: unknown }).window = fakeWindow;
		const sent: unknown[] = [];
		const send = createRegionSender((rects) => sent.push(rects), 700);
		const band = { x: 0, y: 400, width: 1000, height: 150 };
		send([band]);
		// Clipped to the 500px-tall window.
		const clipped = [{ x: 0, y: 400, width: 1000, height: 100 }];
		expect(sent).toEqual([clipped]);
		send([band]);
		expect(sent.length).toBe(1);
		// Off-window rectangles drop out; the region doesn't change.
		send([band, { x: 0, y: 600, width: 10, height: 10 }]);
		expect(sent.length).toBe(1);
		// A display scale change re-sends the same CSS rectangles by itself, so
		// the backend can convert them at the new scale.
		fakeWindow.devicePixelRatio = 1.5;
		scaleChanged();
		expect(sent).toEqual([clipped, clipped]);
	});

	test("reports no change when nothing moved", () => {
		const rects = [{ x: 1, y: 2, width: 3, height: 4 }];
		const a = nextRegion(empty, rects, 0, 700);
		const b = nextRegion(a.state, rects, 50, 700);
		expect(b.changed).toBe(false);
	});

	test("reports a change when only the display scale changed", () => {
		const rects = [{ x: 1, y: 2, width: 3, height: 4 }];
		const a = nextRegion(empty, rects, 0, 700, 1);
		const b = nextRegion(a.state, rects, 50, 700, 1.5);
		expect(b.changed).toBe(true);
		expect(b.rects).toEqual(rects);
	});
});

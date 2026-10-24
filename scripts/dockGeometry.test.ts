import { expect, test } from "bun:test";
import { dockOverlapSpan } from "../src/dockGeometry";

test("smart overlap follows natural content, independently of pill and preview animation", () => {
	// At 150% Bloom scale the same small window still intersects the expanded
	// bar while the live hit area shrinks to a 34px pill. Preview padding is
	// never an input to the overlap measurement.
	const expanded = dockOverlapSpan(1920, 624, 16, 1.5);
	expect(expanded).toEqual({ x: 480, width: 960 });
	const reaches = (x: number, width: number) => x < 620 && x + width > 12;
	expect(reaches(expanded.x, expanded.width)).toBe(true);
	expect(reaches(935, 50)).toBe(false);
	// Pin changes and scale/display changes update the footprint even hidden.
	expect(dockOverlapSpan(1920, 800, 16, 1.5)).toEqual({ x: 348, width: 1224 });
	expect(dockOverlapSpan(2560, 624, 16, 1)).toEqual({ x: 960, width: 640 });
});

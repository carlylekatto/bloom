import { expect, test } from "bun:test";
import { edgeSurfaceContour, resolveCornerRadius } from "../src/components/edgeSurfaceContour";

test("resolves Motion's two percentage axes against the pill, excluding flares", () => {
	const radius = resolveCornerRadius("3.59281% 34.6154%", 693, 52);
	expect(radius[0]).toBeCloseTo(24.8981733, 5);
	expect(radius[1]).toBeCloseTo(18, 4);
	const path = edgeSurfaceContour(719, 52, [radius, radius, [0, 0], [0, 0]], "bottom", true);
	expect(path).toContain(`A ${radius[0]} ${radius[1]}`);
});

test("preserves circular pixel radii and resolves a single percentage on both axes", () => {
	expect(resolveCornerRadius("18px", 693, 52)).toEqual([18, 18]);
	expect(resolveCornerRadius("10%", 200, 50)).toEqual([20, 5]);
	expect(resolveCornerRadius("12px 20%", 200, 50)).toEqual([12, 10]);
	expect(resolveCornerRadius("0px", 200, 50)).toEqual([0, 0]);
});

test("clamps elliptical axes independently instead of flattening wide corners", () => {
	const path = edgeSurfaceContour(226, 52, [[40, 18], [40, 18], [0, 0], [0, 0]], "bottom", true);
	expect(path).toContain("L 13 34 A 40 18 0 0 0 53 52");
	expect(path).toContain("L 173 52 A 40 18 0 0 0 213 34");
});

test("keeps notch and collapsed dock contours rounded with the correct corner pairs", () => {
	const radii = [[18, 12], [16, 10], [8, 6], [7, 5]] as const;
	expect(edgeSurfaceContour(226, 52, radii, "top", true)).toContain("A 8 6");
	const collapsed = edgeSurfaceContour(226, 52, radii, "bottom", false);
	expect(collapsed).toStartWith("M 13 6 A 8 6");
	expect(collapsed).toContain("A 18 12");
	expect(collapsed).toEndWith("Z");
});

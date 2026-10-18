import { useEffect, useRef } from "react";

/**
 * Starts a document-level vertical drag and always tears it down.
 *
 * A slider can unmount or lose focus while a drag is in progress -- the mixer
 * collapses, the panel closes, the window blurs. The listeners are registered on
 * `document`, so they outlive the component that added them and keep sending
 * volume or brightness changes for a slider that no longer exists. Dropping the
 * previous drag before starting a new one, and removing every listener on
 * `mouseup` or `blur`, bounds each drag to one interaction.
 *
 * Returned function takes the starting client Y and begins the drag; `onEnd`
 * runs after the listeners are gone, so it can safely clear component state.
 */
export function useMouseSliderDrag(onMove: (clientY: number) => void, onEnd?: () => void) {
	const moveRef = useRef(onMove);
	const endRef = useRef(onEnd);
	const cleanupRef = useRef<(() => void) | null>(null);
	moveRef.current = onMove;
	endRef.current = onEnd;

	useEffect(() => () => cleanupRef.current?.(), []);

	return (clientY: number) => {
		cleanupRef.current?.();
		moveRef.current(clientY);
		const handleMove = (event: MouseEvent) => moveRef.current(event.clientY);
		const cleanup = () => {
			document.removeEventListener("mousemove", handleMove);
			document.removeEventListener("mouseup", cleanup);
			window.removeEventListener("blur", cleanup);
			cleanupRef.current = null;
			endRef.current?.();
		};
		cleanupRef.current = cleanup;
		document.addEventListener("mousemove", handleMove);
		document.addEventListener("mouseup", cleanup);
		window.addEventListener("blur", cleanup);
	};
}

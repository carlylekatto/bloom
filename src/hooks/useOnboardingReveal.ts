import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/** Keep the real surface visible while its walkthrough card is nearby. */
export function useOnboardingReveal(surface: "island" | "dock") {
	const [revealed, setRevealed] = useState(false);
	useEffect(() => {
		const unlisten = listen<string>("onboarding-surface", ({ payload }) => {
			setRevealed(payload === surface);
		});
		return () => {
			void unlisten.then((stop) => stop());
		};
	}, [surface]);
	return revealed;
}

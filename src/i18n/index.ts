import { useTranslation as useReactTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { translator, resolveLanguage, type LocaleCode } from "./runtime";
export { LOCALES, resolveLanguage, normalizeLanguageSetting } from "./runtime";
export type { LocaleCode, LanguageSetting } from "./runtime";

export const t = translator.t;
export const tCount = translator.tCount;
export const getLocale = translator.getLocale;

export function setLocale(locale: LocaleCode) {
	translator.setLocale(locale);
	if (typeof document !== "undefined") {
		document.documentElement.lang = locale;
		document.documentElement.dir = "ltr";
	}
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		void invoke("set_tray_language", { locale }).catch((error) =>
			console.warn("Could not update tray language:", error)
		);
	}
}

/** Apply the startup mirror; backend settings remain authoritative. */
export function initI18n() {
	let setting: string | null = null;
	try {
		setting = localStorage.getItem("bloom-language");
	} catch {
		/* storage unavailable */
	}
	setLocale(resolveLanguage(setting));
}

/** Subscribe even in memoized components; bundled catalogs need no suspense. */
export function useTranslation() {
	useReactTranslation("translation", { i18n: translator.instance, useSuspense: false });
	return { t, tCount, locale: getLocale(), setLocale };
}

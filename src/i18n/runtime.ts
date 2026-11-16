import en from "./locales/en.json";
import ru from "./locales/ru.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import ptBR from "./locales/pt-BR.json";
import ptPT from "./locales/pt-PT.json";
import { createTranslator } from "./engine";

export const LOCALES = [
	{ code: "en", nativeName: "English" },
	{ code: "ru", nativeName: "Русский" },
	{ code: "fr", nativeName: "Français" },
	{ code: "es", nativeName: "Español" },
	{ code: "pt-BR", nativeName: "Português (Brasil)" },
	{ code: "pt-PT", nativeName: "Português (Portugal)" }
] as const;
export type LocaleCode = (typeof LOCALES)[number]["code"];
export type LanguageSetting = "system" | LocaleCode;

export const translator = createTranslator(en, { en, ru, fr, es, "pt-BR": ptBR, "pt-PT": ptPT });

function matchLocale(language: string): LocaleCode | undefined {
	const normalized = language.trim().replace(/_/g, "-").toLowerCase();
	return (
		LOCALES.find((locale) => locale.code.toLowerCase() === normalized)?.code ??
		LOCALES.find((locale) => locale.code.toLowerCase() === normalized.split("-")[0])?.code
	);
}

export function normalizeLanguageSetting(value: unknown): LanguageSetting {
	if (value == null || value === "" || value === "system") return "system";
	return typeof value === "string" ? (matchLocale(value) ?? "en") : "en";
}

export function resolveLanguage(
	setting: string | null | undefined,
	languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages
): LocaleCode {
	if (setting && setting !== "system") return matchLocale(setting) ?? "en";
	for (const language of languages) {
		const match = matchLocale(language);
		if (match) return match;
	}
	return "en";
}

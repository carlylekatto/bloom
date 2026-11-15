import { createInstance } from "i18next";
import { sanitizeCatalog, type Catalog } from "./catalog";

type Params = Record<string, string | number>;

/** Factory allows fallback tests without a DOM or Tauri. */
export function createTranslator(english: Catalog, catalogs: Record<string, unknown>) {
	const instance = createInstance();
	const resources = Object.fromEntries(
		Object.entries(catalogs).map(([locale, catalog]) => [
			locale,
			{ translation: sanitizeCatalog(english, catalog) }
		])
	);
	resources.en = { translation: english };
	void instance.init({
		lng: "en",
		fallbackLng: "en",
		resources,
		initAsync: false,
		returnEmptyString: false,
		returnNull: false,
		// React escapes rendered text; keep i18next's default {{name}} syntax.
		interpolation: { escapeValue: false }
	});
	const t = (key: string, params?: Params): string => String(instance.t(key, params ?? {}));
	return {
		instance,
		t,
		tCount: (key: string, count: number, params?: Params) => t(key, { ...params, count }),
		getLocale: () => instance.language,
		setLocale: (locale: string) => {
			void instance.changeLanguage(locale);
		}
	};
}

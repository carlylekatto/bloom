//! Native tray messages use the same bundled catalogs as the webviews.
use serde_json::Value;
use tauri::{menu::MenuItem, AppHandle, Manager, Wry};

pub struct TrayMessages {
    pub settings: MenuItem<Wry>,
    pub restart: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
}

fn catalog(locale: &str) -> Value {
    let source = match locale {
        "ru" => include_str!("../../src/i18n/locales/ru.json"),
        "fr" => include_str!("../../src/i18n/locales/fr.json"),
        "es" => include_str!("../../src/i18n/locales/es.json"),
        "pt-BR" => include_str!("../../src/i18n/locales/pt-BR.json"),
        "pt-PT" => include_str!("../../src/i18n/locales/pt-PT.json"),
        _ => "{}",
    };
    serde_json::from_str(source).unwrap_or(Value::Null)
}

fn message<'a>(english: &'a Value, translated: &'a Value, key: &str) -> &'a str {
    translated
        .pointer(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty() && !text.contains(['{', '}']))
        .or_else(|| english.pointer(key).and_then(Value::as_str))
        .unwrap_or("Bloom")
}

#[tauri::command]
pub fn set_tray_language(app: AppHandle, locale: String) -> Result<(), String> {
    let Some(menu) = app.try_state::<TrayMessages>() else {
        return Ok(()); // Webviews can initialize before setup finishes.
    };
    let english: Value = serde_json::from_str(include_str!("../../src/i18n/locales/en.json"))
        .map_err(|error| error.to_string())?;
    let translated = catalog(&locale);
    for (item, key) in [
        (&menu.settings, "/dock/options/openSettings"),
        (&menu.restart, "/dock/options/restart"),
        (&menu.quit, "/dock/options/quit"),
    ] {
        item.set_text(message(&english, &translated, key))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn partial_native_catalogs_use_english() {
        let english = json!({"title": "Settings"});
        for invalid in [
            Value::Null,
            json!(""),
            json!("  "),
            json!(12),
            json!("{unknown}"),
        ] {
            assert_eq!(
                message(&english, &json!({"title": invalid}), "/title"),
                "Settings"
            );
        }
        assert_eq!(message(&english, &json!({}), "/title"), "Settings");
        assert_eq!(
            message(&english, &json!({"title": "Paramètres"}), "/title"),
            "Paramètres"
        );
    }

    #[test]
    fn native_catalogs_share_the_frontend_messages() {
        let english: Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en.json")).unwrap();
        for locale in ["en", "fr", "es", "pt-BR", "pt-PT", "ru", "unknown"] {
            let translated = catalog(locale);
            for key in [
                "/dock/options/openSettings",
                "/dock/options/restart",
                "/dock/options/quit",
            ] {
                let text = message(&english, &translated, key);
                assert!(!text.is_empty());
                assert_ne!(text, "Bloom");
            }
        }
    }
}

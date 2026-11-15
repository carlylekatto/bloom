# Localization implementation

Updated November 15, 2026. Work continues on the original `feat/i18n-foundation` branch, with current main merged without rewriting history. The old custom translation engine has been replaced with i18next/react-i18next; useful catalogs and extraction work were retained and updated for current UI.

## Contributor workflow

Start with GitHub file edits and a translation contribution issue form. Contributors can send English phrases and their translations without installing development tools. The generated [English phrase reference](TRANSLATION_REFERENCE.md) gives issue contributors a readable source. Browser editing uses GitHub's standard fork-and-PR workflow; cloning is optional. Crowdin is deferred; the catalogs can be imported later. See [TRANSLATING.md](../TRANSLATING.md).

## Behavior

- English is the complete source catalog; other languages may be partial.
- Catalogs use standard i18next JSON v4, default `{{name}}` placeholders, and `_one`/`_other` plural suffixes. There is no custom catalog conversion.
- Missing, blank, whitespace, invalid-type, or placeholder-invalid messages fall back to English.
- Plural fallback selects grammar using each candidate language's own rules.
- Language settings synchronize through existing settings events across all four webviews, including external edits and deletion. Native tray labels use the same bundled catalogs.
- Exact regional matches are preserved. Brazilian and European Portuguese are distinct. Unsupported locales use English.
- The app works offline. No translation service, account, credential, or new network origin is needed.
- Settings preview routing uses stable identifiers instead of visible English labels.

English and the earlier Russian translations are included. French, Spanish, Brazilian Portuguese, and European Portuguese have empty starter catalogs; selecting them currently uses English. Russian is partial and still needs native-speaker review. This change prepares contribution and safe fallback; it does not claim those new languages are already translated.

## Validation

The catalog checker and fallback tests run in CI. Missing target messages report coverage without failing; malformed entries and missing literal English keys fail. Dynamic keys and translation accuracy require review.

Commands: `bun run i18n:check`, `bun run i18n:test`, `bun run build`, plus the normal Rust gates when native code changes. Use `bun run i18n:check --missing` for the remaining messages.

Windows smoke checks cover selecting an empty catalog, mixed Russian/English UI, persistence when Settings reopens, and the live Settings layout. Exhaustive language review, all display scales, and every panel/device configuration require community testing. RTL locales require a separate layout pass before registration.

# Help translate Bloom

You can contribute a few phrases or a whole screen. You do not need to finish a language, install Bloom's development tools, or know how to code.

Bloom uses English wherever a translation is missing. New features can ship while translations catch up. Translations are bundled with releases and work offline.

## Where to find the English phrases

Start with the [English phrase reference](docs/TRANSLATION_REFERENCE.md). It lists the English messages in readable tables, grouped by area. Pick one area, such as General settings, rather than trying to translate the entire app at once. Use your browser's Find command to locate a phrase. Each row has a reference key that you can copy to help us identify it; you do not need to understand the key.

The reference is generated from [`en.json`](src/i18n/locales/en.json), which is the source of truth. Maintainers update it whenever the English catalog changes, and CI checks that it stays current. It can include text that has not reached a release yet.

For visual context, use Bloom with **Settings → General → Language → English**. A screenshot or screen name is useful for a phrase whose meaning is unclear. You can also ask about it in your contribution issue before translating it.

Both contribution routes below require a free GitHub account. You do not need Git, a local copy of the project, or development tools for either route.

## Option 1: send translations in an issue

This is the easiest route if you want to send words without editing JSON. **No fork is needed.**

1. Search the [open issues](https://github.com/little-systems/bloom/issues) for your language to see whether someone is already working on it. You can coordinate there instead of duplicating their work.
2. Open a [translation contribution](https://github.com/little-systems/bloom/issues/new?template=translation.yml). Specify your language and region, such as Brazilian or European Portuguese.
3. Use the [English phrase reference](docs/TRANSLATION_REFERENCE.md) to choose a small batch. For each entry, give its English text and your translation. Include the reference key when possible, especially if the same word appears in different places.
4. Submit the issue. A maintainer will review the wording with you and add it to the language file.

For example:

```text
Language: French
Area: Shared controls
Reference key: common.cancel
English: Cancel
Translation: Annuler
```

A few phrases are useful; you do not have to list every message or finish a language. For many entries, you can paste a table with **Reference key | English | Translation** columns. For a full-language contribution, editing the file directly is usually easier than copying hundreds of phrases into an issue. You can also use the form just to offer translation or review help.

## Option 2: edit a language file in your browser

This route is useful for larger batches if you are comfortable editing JSON. **Contributors without write access use a fork.** A fork is your own copy of Bloom's repository on GitHub, under your account. A clone is a downloaded copy on your computer; you do not need a clone for browser editing.

| Language | File to edit |
| --- | --- |
| French | [`fr.json`](src/i18n/locales/fr.json) |
| Spanish | [`es.json`](src/i18n/locales/es.json) |
| Brazilian Portuguese | [`pt-BR.json`](src/i18n/locales/pt-BR.json) |
| European Portuguese | [`pt-PT.json`](src/i18n/locales/pt-PT.json) |
| Russian | [`ru.json`](src/i18n/locales/ru.json) |

If your language is missing, open a translation issue first. A maintainer can create and register its file so you only need to translate text.

1. Sign in to GitHub and open your language file using the table above. Start from this repository's current `main` branch. Keep [`en.json`](src/i18n/locales/en.json) open in a second browser tab for the keys and nesting; the readable [phrase reference](docs/TRANSLATION_REFERENCE.md) helps you find an area to work on.
2. Click the pencil icon (**Edit this file**). If GitHub asks, choose **Fork this repository**. GitHub creates or uses a fork under your account as part of this process. You do not need to create one in advance. This is GitHub's [normal file-edit contribution workflow](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files#editing-files-in-another-users-repository).
3. Add the entries you translated, keeping the English file's keys and nesting. Edit your language file, **not `en.json`**. Preserve existing translations unless you are intentionally correcting them. Leave untranslated entries out; an empty starter file is `{}`.
4. Click **Commit changes…** or **Propose changes** (the label depends on GitHub's screen). Add a short description such as `Translate General settings into French`. Save the change on a branch in your fork; a branch keeps this proposed edit together.
5. Continue through **Propose changes** / **Compare & pull request**, then finish with **Create pull request**. The destination should be `little-systems/bloom`, branch `main`; the source is the branch in your fork. A pull request, or PR, is your request for us to review and include the change. Saving to your fork alone does not update Bloom.
6. Include your language and the areas you translated in the PR description. Automated checks will report JSON or placeholder mistakes, and a maintainer can help fix them. If you make follow-up edits, save them to the **same branch in your fork** to update that PR.

You can also fork and clone the project to edit locally if you already know Git. That is optional; the browser steps above are sufficient.

For example, this is a complete, valid partial French file:

```json
{
  "common": {
    "cancel": "Annuler"
  },
  "settings": {
    "title": "Paramètres"
  }
}
```

Every other message will still appear in English. Do not copy all the English text into your file: that makes it harder to see what still needs translation. JSON requires double quotes and no trailing comma after the last entry.

## Wording guidelines

- Translate the values, keeping the keys unchanged. Keep names such as Bloom and Windows unchanged.
- Keep placeholders exactly as written. For example, `Version {{version}}` must still contain `{{version}}`. Bloom replaces it with the actual version; you can move it to wherever it belongs in your language.
- Keep labels short: Bloom has small buttons, a compact notch, menus, and popovers. Translate whole messages naturally rather than word by word.
- Keep the tone clear and direct. Use consistent wording for Dock, Island/Notch, and Command Center. Explain terminology choices when opening your PR so other contributors can review them.
- Do not insert HTML. Messages are displayed as text. Preserve meaningful newlines.
- Do not submit blank values to hide text. Remove an unfinished entry so English is used.
- App names, song titles, filenames, network names, and device names come from Windows or the user. Those are not catalog translations. Technical details returned by Windows can also remain in their original language.

Plural messages use i18next's standard suffixes. English usually has `_one` and `_other`; Russian also needs `_few` and `_many`. For example, English has `countOpenWindows_one: "{{count}} open window"` and `countOpenWindows_other: "{{count}} open windows"`. Use the forms your language needs and preserve `{{count}}` in every form. You can ask a maintainer for help with plurals. Partial translations are allowed: a missing form uses English grammar when falling back to English.

## Try it in Bloom

In a build containing your changes, choose **Settings → General → Language**. The selection applies live to Settings, the notch, dock, overlays, and Bloom's native tray menu, and is remembered after restart. Check long labels, menus, keyboard-accessible names, and larger UI scales. Selecting an empty starter catalog intentionally displays English until translations are added.

Language files are included in a normal release; editing a file on GitHub does not change an already installed build.

## Maintainer and developer notes

The app uses i18next/react-i18next and [standard i18next JSON v4 catalogs](https://www.i18next.com/misc/json-format): nested message keys, default `{{name}}` interpolation, and `_one`/`_other` plural suffixes. Files are passed directly to i18next; there is no Bloom-specific format conversion. The `tCount` convenience helper calls the normal `t(key, { count })` API. Catalogs can later be imported into tooling that supports i18next JSON v4.

English is the source of truth. Bloom's validation rejects malformed submissions, and runtime sanitization discards unknown entries, empty/whitespace text, invalid types, and messages with incorrect placeholders before i18next resolves per-message English fallback. These checks do not require translators to learn a custom file format. Catalogs are bundled locally; no translation account, service, credential, or network request is required by the app.

```powershell
bun run i18n:check
bun run i18n:check --missing
bun run i18n:reference
bun run i18n:reference --check
bun run i18n:test
bun run build
```

The checker reports coverage without failing on missing translations. Malformed JSON, unknown keys, invalid values, placeholder mismatches, and literal calls missing English messages fail CI. Coverage compares English entries; extra plural forms do not inflate it. Dynamic message-key expressions still require code review.

For new UI, add a complete English message and use `t("semantic.messageKey", { name })` with `{{name}}` in the message. Translate complete sentences, not concatenated fragments, so word order can change. For counts use `tCount("semantic.message", count)` or `t("semantic.message", { count })`, with `message_one`/`message_other` English source entries. Run `bun run i18n:reference` after changing English, and commit the generated reference. Use stable identifiers for program behavior; do not compare translated labels. Components rendering translations must call `useTranslation()` so changes also update memoized UI. Add the locale to memo dependencies when translated output is cached.

Do not require contributors to update every language for a new feature. When English meaning changes, use a new semantic key or explicitly request review of existing translations; the validator cannot judge whether wording is still accurate.

To add another language, create a partial JSON catalog, import/register it in `src/i18n/runtime.ts`, and add its bundled catalog to `src-tauri/src/i18n.rs` for the native tray. Use canonical locale codes and native display names. Regional variants are distinct; an unsupported Portuguese region does not silently select Brazilian or European Portuguese. Add the relevant fallback/locale tests. The currently registered languages use left-to-right layout; right-to-left languages require a separate layout pass before being offered in the picker.

Before release run the normal frontend/Rust gates and test a deliberately partial catalog on Windows. Include startup, live switching, external edits/removal of `bloom-language`, import/reset, saved-language restart, native tray, long strings, and larger UI scale. These cases matter beyond checking the JSON files.

If translation volume later justifies Crowdin or another service, import these same catalogs and let it propose reviewed PRs. The application and English fallback do not depend on that choice. Contributions remain covered by Bloom's GPL-3.0 license.

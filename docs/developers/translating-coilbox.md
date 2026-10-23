# Translate coilbox

Coilbox shows its text in English, French, German, Spanish, Polish, Ukrainian, Japanese and Simplified Chinese. Every string a player reads in the app lives in one catalog file per language, and you translate by editing that file and sending a pull request.

This page is for translators and for anyone adding a language. It covers where the catalogs are, how to edit an entry without breaking it, how to refresh and check them, how to add a language, and which words stay in English.

## Where the catalogs are

Each language has one file, `src/locales/<code>/messages.po`, in the [coilbox repository](https://github.com/tomjn/coilbox):

- `src/locales/en/messages.po` is the English source. You never edit it by hand.
- `src/locales/fr/messages.po`, `de`, `es`, `pl`, `uk`, `ja` and `zh-Hans` are the translations.
- `src/locales/en-XA/messages.po` is the [pseudo-locale](#find-untranslated-text-with-the-pseudo-locale). It is generated, so leave it alone.

The files use the gettext `.po` format, so any `.po` editor such as Poedit opens them, as does a plain text editor. Coilbox reads them through [Lingui](https://lingui.dev).

## Read an entry

An entry looks like this:

```po
#. placeholder {0}: rest.length
#: src/home/zones/Greeting.tsx
#, fuzzy
msgid "{0, plural, one {{first} and # other} other {{first} and # others}}"
msgstr "{0, plural, one {{first} et # autre} other {{first} et # autres}}"
```

- `msgid` is the English text. It is also how coilbox finds the entry, so never change it. If the English is wrong, fix it in the source file and the catalogs follow.
- `msgstr` is your translation. An empty `msgstr` shows the English.
- `#:` names the source file the text comes from. Open it when you need to see where the text appears.
- `#.` says what a numbered placeholder such as `{0}` holds.
- `msgctxt`, on a few entries, separates two uses of the same English word. "Turn" in Conquest is a game turn and has its own entry with `msgctxt "Conquest turn"`.
- `#, fuzzy` marks a translation nobody has checked yet. Every catalog started as a first pass written by an AI model, and those entries all carry the flag. Coilbox shows fuzzy entries all the same. Delete the `#, fuzzy` line when a native speaker has read the entry and it is right.

## Write a translation that works

Messages use the ICU message format, and a mistake in it can break the whole catalog. Keep to these rules:

- Keep every placeholder exactly as it is. `{gameName}`, `{0}` and `{count}` are filled in when coilbox runs. You can move them, but not rename, translate or drop them.
- Keep the shape of a plural. In `{0, plural, one {...} other {...}}`, translate only the text inside the inner braces. `#` stands for the number.
- Use the plural forms your language needs. English has `one` and `other`. Polish and Ukrainian need `one`, `few`, `many` and `other`. Japanese and Chinese need only `other`. Check the [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) for yours.
- Keep numbered tags. `<0>Checks</0>` wraps text that becomes a link or code, so `<0>` and `</0>` stay around the translated words.
- Use a typographic apostrophe `’`, not `'`. A straight apostrophe before `{` or `#` starts a quoted literal, which hides the placeholder after it. Write `''` if you need a straight one.

Dates, numbers, file sizes and durations are not in the catalogs. Coilbox formats them for the chosen language itself.

## Refresh the catalogs

When code adds, changes or removes English text, the catalogs have to follow. Run:

```sh
bun run i18n:extract
```

It reads every source file under `src`, adds each new English string to every catalog with an empty `msgstr`, and removes entries whose English no longer appears anywhere. Your translations of unchanged strings stay as they are.

There is no separate compile step. Lingui's Vite plugin compiles a catalog when the app loads it, in `bun tauri dev` and in the release build.

Commit the changed `.po` files with the code. CI runs the extract again and fails if the catalogs differ from what you committed.

## Check your work

1. Run `bun run test src/i18n/catalogs.test.ts`. It compiles every catalog and fails on a message that does not compile, such as a missing closing brace.
2. Run `bun tauri dev`.
3. Open Settings, then General, and pick your language under Display. The app changes language at once.
4. Look through the pages you translated for text that is cut off or wraps badly.

Each pull request's checks include a Translation coverage table in the frontend job's summary. It lists how many strings each language has translated and how many are missing, so you can see what a change left in English. It never fails the build.

## Add a language

1. Add the language code to `LOCALES` in `src/i18n/locales.ts`. Use a BCP 47 code, such as `nl` or `pt-BR`. The order of the list is the order of the Language picker and of the language page in first-run setup.
2. Run `bun run i18n:extract`. It creates `src/locales/<code>/messages.po` with every English string and no translations.
3. Translate the catalog.
4. Add the language to the tests. `src/i18n/locales.test.ts` checks which system language picks it and the name it shows. `src/general/pages/SettingsSection.language.dom.test.tsx` lists the picker's options in order.

Nothing else needs wiring. `lingui.config.ts`, the Language picker and the first-run language page all read `LOCALES`, and the picker names each language in its own words through the browser's `Intl.DisplayNames`.

When the language setting is System, coilbox picks a catalog by the base language of the system's language, so `fr-CA` gets `fr`. A code with a region or script, such as `pt-BR` or `zh-Hans`, never matches a base language on its own. Give it a rule in `resolveLocaleTag`, in the same file, as `zh-Hans` has.

## Find untranslated text with the pseudo-locale

A development build has one more language in the picker, Pseudo. It shows every message with accented letters, padded 30 percent longer with `~` and wrapped in square brackets. "Download a game" becomes:

```
[~~Ďōŵńĺōàď à ĝàḿē~~]
```

Two kinds of problem stand out:

- Plain English on screen is text that never went through the translation runtime, so no catalog can change it. Report it as a bug or fix the code.
- A closing bracket that is missing or cut off is a space too small for a longer language. German and French often run that long.

Release builds leave Pseudo out.

## Words that stay in English

Some words are names or are read by other programs, so translating them breaks something or confuses players. Leave these as they are, inside a translated sentence:

- Rapid, the engine's package system.
- SPADS, the autohost.
- unitsync, the engine library coilbox reads games and maps with.
- modoptions, tweakdefs and tweakunits.
- Spring and Recoil, the engine's names.
- Game names, such as Beyond All Reason or Splinter Faction, and map names.
- Engine version strings, such as `2026.07.04-46-g04f42e2`.

Also leave alone anything coilbox sends to or reads from another program:

- Lobby protocol text.
- Autohost commands that start with `!`.
- Start script keys.
- Modoption names.
- File and folder names, such as `springsettings.cfg` or `mapinfo.lua`.
- `springsettings.cfg` keys.
- Log line prefixes.

## What is not in the catalogs yet

The in-game widgets, such as the mission UI, the rewind timeline and the blueprint widget, still draw English. Their string tables are [#4597](https://github.com/tomjn/coilbox/issues/4597). A distribution profile that ships its own language pack is [#4598](https://github.com/tomjn/coilbox/issues/4598). This page will cover both when they land.

This site is in English only.

## Send your translation

Open a pull request on the [coilbox repository](https://github.com/tomjn/coilbox) that changes the `.po` file. Say in the description which language it is and whether you are a native speaker, so a reviewer knows which `#, fuzzy` lines you took off on purpose.

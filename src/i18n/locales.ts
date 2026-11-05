/**
 * The locales coilbox ships a catalog for, and the rule that picks one from the
 * system's language tag. `lingui.config.ts` reads `LOCALES` too, so the list
 * the extractor writes catalogs for and the list the picker offers cannot drift.
 * No imports, so the Lingui CLI can load this file.
 */

/** `en` is the source language, and the fallback for any tag nothing matches. */
export const LOCALES = [
  "en",
  "fr",
  "de",
  "es",
  "pl",
  "uk",
  "pt-BR",
  "nb",
  "sv",
  "nl",
  "it",
  "ja",
  "zh-Hans",
] as const;

export type LocaleCode = (typeof LOCALES)[number];

export const SOURCE_LOCALE: LocaleCode = "en";

/**
 * The dev-only pseudo-locale (#4593): every English message with its letters
 * accented, padded and wrapped in brackets, so plain English on screen is a
 * string that never went through `t`, and a clipped bracket is a layout that
 * cannot take a longer language. Lingui generates it from the source catalog.
 * `en-XA` is the conventional pseudo-locale tag, and `Intl` treats it as `en`.
 */
export const PSEUDO_LOCALE = "en-XA";

/**
 * Whether the pseudo-locale can be chosen. `import.meta.env` is undefined when
 * the Lingui CLI loads this file, which reads as a release build.
 */
const PSEUDO_ENABLED = import.meta.env?.DEV === true;

/**
 * A locale coilbox can run in: one with a catalog, the pseudo-locale, or a code
 * a profile's language pack adds (see `./packs`).
 */
export type AppLocale = LocaleCode | typeof PSEUDO_LOCALE | (string & {});

/** The settings value that means "follow the system language". */
export const SYSTEM_LANGUAGE = "system";

/** Subtags that mark a Chinese tag as Traditional rather than Simplified. */
const TRADITIONAL_SUBTAGS = new Set(["hant", "tw", "hk", "mo"]);

/** Whether `code` names a locale with a catalog. */
export function isLocale(code: string): code is LocaleCode {
  return (LOCALES as readonly string[]).includes(code);
}

/**
 * The locale for a BCP 47 tag such as `navigator.language`. The base language
 * picks the locale, so `fr-CA` is `fr`. Every `zh` tag is `zh-Hans` unless it
 * is Traditional (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`), which has no catalog
 * and so gets `en`. Every `pt` tag is `pt-BR`, including `pt-PT`, because
 * there is no European Portuguese catalog. `no` (Norwegian) is `nb`
 * (Bokmål), and `nn` (Nynorsk) has no catalog and so gets `en`. Anything else
 * without a catalog gets `en`.
 */
export function resolveLocaleTag(tag: string): LocaleCode {
  const [base, ...rest] = tag.toLowerCase().split(/[-_]/);
  if (base === "zh") {
    return rest.some((s) => TRADITIONAL_SUBTAGS.has(s))
      ? SOURCE_LOCALE
      : "zh-Hans";
  }
  if (base === "pt") return "pt-BR";
  if (base === "no") return "nb";
  return LOCALES.find((l) => l.toLowerCase() === base) ?? SOURCE_LOCALE;
}

/**
 * The locale to run in for a stored `general.language` value. "system" (and
 * anything unrecognised, such as a code from a newer build) follows
 * `systemTag`. `extra` are the codes a profile's language packs add.
 */
export function resolveLanguage(
  stored: string,
  systemTag: string,
  extra: readonly string[] = [],
): AppLocale {
  if (PSEUDO_ENABLED && stored === PSEUDO_LOCALE) return PSEUDO_LOCALE;
  if (isLocale(stored) || extra.includes(stored)) return stored;
  return resolveLocaleTag(systemTag);
}

/**
 * The locales the Language picker offers: the bundled ones, then the codes in
 * `extra`, then the pseudo-locale in dev.
 */
export function pickerLocales(extra: readonly string[] = []): string[] {
  return [...LOCALES, ...extra, ...(PSEUDO_ENABLED ? [PSEUDO_LOCALE] : [])];
}

/** A locale's name in its own language, which is how the picker lists it. */
export function localeDisplayName(code: string): string {
  if (code === PSEUDO_LOCALE) return "Pseudo";
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
}

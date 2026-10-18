/**
 * The locales coilbox ships a catalog for, and the rule that picks one from the
 * system's language tag. `lingui.config.ts` reads `LOCALES` too, so the list
 * the extractor writes catalogs for and the list the picker offers cannot drift.
 * No imports, so the Lingui CLI can load this file.
 */

/** `en` is the source language, and the fallback for any tag nothing matches. */
export const LOCALES = ["en", "fr", "de", "es", "ja", "zh-Hans"] as const;

export type LocaleCode = (typeof LOCALES)[number];

export const SOURCE_LOCALE: LocaleCode = "en";

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
 * and so gets `en`. Anything else without a catalog gets `en`.
 */
export function resolveLocaleTag(tag: string): LocaleCode {
  const [base, ...rest] = tag.toLowerCase().split(/[-_]/);
  if (base === "zh") {
    return rest.some((s) => TRADITIONAL_SUBTAGS.has(s))
      ? SOURCE_LOCALE
      : "zh-Hans";
  }
  return LOCALES.find((l) => l.toLowerCase() === base) ?? SOURCE_LOCALE;
}

/**
 * The locale to run in for a stored `general.language` value. "system" (and
 * anything unrecognised, such as a code from a newer build) follows
 * `systemTag`.
 */
export function resolveLanguage(stored: string, systemTag: string): LocaleCode {
  return isLocale(stored) ? stored : resolveLocaleTag(systemTag);
}

/** A locale's name in its own language, which is how the picker lists it. */
export function localeDisplayName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
}

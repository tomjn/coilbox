import { useSetting } from "@picoframe/frame";
import { useEffect } from "react";
import { getProfile } from "../profile/profile";
import { loadLocale } from ".";
import {
  type AppLocale,
  isLocale,
  resolveLanguage,
  SYSTEM_LANGUAGE,
} from "./locales";
import { getLocalePack, packOnlyLocales } from "./packs";

export const LANGUAGE_KEY = "general.language";

/**
 * The language a player who has never chosen one gets: the profile's
 * `defaultLocale` when it names a bundled locale or a loaded pack, and "system"
 * otherwise.
 */
export function defaultLanguage(): string {
  const code = getProfile().defaultLocale;
  return typeof code === "string" && (isLocale(code) || getLocalePack(code))
    ? code
    : SYSTEM_LANGUAGE;
}

/** `[language, setLanguage]` for the stored choice: a locale code or "system". */
export function useLanguageSetting() {
  return useSetting<string>(LANGUAGE_KEY, defaultLanguage());
}

/**
 * The locale coilbox is running in: the stored choice, or the system language
 * when that is "system". Formatting helpers read this rather than
 * `navigator.language`, so a date or number follows the picker.
 */
export function useResolvedLocale(): AppLocale {
  const [language] = useLanguageSetting();
  return resolveLanguage(language, navigator.language, packOnlyLocales());
}

/**
 * The locale to load before first render, from the raw stored value (settings
 * are kept as JSON, so a stored choice reads back as `"fr"` with its quotes).
 * Nothing stored means the player never chose, so the profile's default applies.
 */
export function bootLocale(raw: string | null): AppLocale {
  let stored: unknown = defaultLanguage();
  try {
    if (raw !== null) stored = JSON.parse(raw);
  } catch {
    // An unreadable value is treated as unset.
  }
  return resolveLanguage(
    typeof stored === "string" ? stored : SYSTEM_LANGUAGE,
    navigator.language,
    packOnlyLocales(),
  );
}

/**
 * Keep the loaded catalog, and `<html lang>` with it, on the resolved locale.
 * Called once, from the general plugin's provider.
 */
export function useApplyLanguage(): void {
  const locale = useResolvedLocale();
  useEffect(() => {
    loadLocale(locale).catch((e) =>
      console.warn(`i18n: could not load locale ${locale}`, e),
    );
  }, [locale]);
}

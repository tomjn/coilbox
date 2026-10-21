import { i18n, type Messages } from "@lingui/core";
import { PSEUDO_LOCALE, SOURCE_LOCALE } from "./locales";

/**
 * The one translation runtime. It is Lingui's global instance, so the `t`
 * macro from `@lingui/core/macro` reads it in plain TS modules, and the
 * `<I18nProvider>` in `src/main.tsx` hands it to React.
 */
export { i18n };

/**
 * The active locale code, for `Intl` and `toLocale*String` calls. It reads
 * Lingui's instance, so it works in plain modules as well as components, and it
 * is `en` until the first catalog has loaded.
 */
export function getLocale(): string {
  return i18n.locale || SOURCE_LOCALE;
}

/**
 * The shipped catalogs, one lazy chunk each. The pseudo-locale is left out here
 * and imported behind `import.meta.env.DEV` in `importCatalog`, so a release
 * build drops it.
 */
const catalogs = import.meta.glob<{ messages: Messages }>([
  "../locales/*/messages.po",
  "!../locales/en-XA/messages.po",
]);

function importCatalog(code: string): Promise<{ messages: Messages }> {
  if (import.meta.env.DEV && code === PSEUDO_LOCALE) {
    return import("../locales/en-XA/messages.po");
  }
  const load = catalogs[`../locales/${code}/messages.po`];
  if (!load) return Promise.reject(new Error(`no catalog for ${code}`));
  return load();
}

/** The locale most recently asked for, so a slow load cannot overwrite a later pick. */
let requested: string | undefined;

/**
 * Load the catalog for `code` from `src/locales/<code>/messages.po`, make it the
 * active locale and set `<html lang>` to it. The Lingui vite plugin compiles the
 * `.po` file when it is imported, so each locale is its own chunk, fetched only
 * when chosen. If another locale is requested while this one loads, this one is
 * dropped.
 */
export async function loadLocale(code: string): Promise<void> {
  requested = code;
  const { messages } = await importCatalog(code);
  if (requested !== code) return;
  i18n.loadAndActivate({ locale: code, messages });
  document.documentElement.lang = code;
}

import { i18n } from "@lingui/core";

/**
 * The one translation runtime. It is Lingui's global instance, so the `t`
 * macro from `@lingui/core/macro` reads it in plain TS modules, and the
 * `<I18nProvider>` in `src/main.tsx` hands it to React.
 */
export { i18n };

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
  const { messages } = await import(`../locales/${code}/messages.po`);
  if (requested !== code) return;
  i18n.loadAndActivate({ locale: code, messages });
  document.documentElement.lang = code;
}

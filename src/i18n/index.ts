import { i18n } from "@lingui/core";

/**
 * The one translation runtime. It is Lingui's global instance, so the `t`
 * macro from `@lingui/core/macro` reads it in plain TS modules, and the
 * `<I18nProvider>` in `src/main.tsx` hands it to React.
 */
export { i18n };

/**
 * Load the catalog for `code` from `src/locales/<code>/messages.po` and make
 * it the active locale. The Lingui vite plugin compiles the `.po` file when
 * it is imported, so each locale is its own chunk, fetched only when chosen.
 */
export async function loadLocale(code: string): Promise<void> {
  const { messages } = await import(`../locales/${code}/messages.po`);
  i18n.loadAndActivate({ locale: code, messages });
}

import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";
import { LOCALES, SOURCE_LOCALE } from "./src/i18n/locales";

export default defineConfig({
  sourceLocale: SOURCE_LOCALE,
  locales: [...LOCALES],
  // An untranslated message falls back to its English source.
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
    },
  ],
  // Origins without line numbers, so an edit that only moves a string down a
  // file does not change the catalogs and fail the extract check.
  format: formatter({ lineNumbers: false }),
});

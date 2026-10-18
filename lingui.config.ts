import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "fr", "de", "es", "ja", "zh-Hans"],
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

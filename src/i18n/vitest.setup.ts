import { i18n } from "@lingui/core";
import { createElement, useContext } from "react";
import { vi } from "vitest";

// Lingui throws on a `t` call before any locale is active. The app loads one
// before first render, so tests start in the source language the same way.
i18n.loadAndActivate({ locale: "en", messages: {} });

// The app renders everything inside `<I18nProvider>` (src/main.tsx), but most
// DOM tests render one component on its own. Lingui's `useLingui` and `<Trans>`
// throw without a provider, so here they fall back to the global instance when
// none is mounted. A test that mounts its own provider gets the real behaviour.
vi.mock("@lingui/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@lingui/react")>();
  const fallback = () => ({ i18n, _: i18n.t.bind(i18n) });
  return {
    ...real,
    useLingui: () => useContext(real.LinguiContext) ?? fallback(),
    Trans: (props: Parameters<typeof real.Trans>[0]) => {
      const trans = createElement(real.Trans, props);
      return useContext(real.LinguiContext)
        ? trans
        : createElement(real.I18nProvider, { i18n }, trans);
    },
  };
});

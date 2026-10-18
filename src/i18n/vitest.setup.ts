import { i18n } from "@lingui/core";

// Lingui throws on a `t` call before any locale is active. The app loads one
// before first render, so tests start in the source language the same way.
i18n.loadAndActivate({ locale: "en", messages: {} });

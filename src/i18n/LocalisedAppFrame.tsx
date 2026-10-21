import { useLingui } from "@lingui/react/macro";
import { AppFrame } from "@picoframe/frame";
import { type ComponentProps, useMemo } from "react";
import { useFrameStrings } from "./frameStrings";
import { localisePlugins } from "./pluginText";

/**
 * `AppFrame` with the active locale, the frame's translated words and the
 * plugins' nav labels, crumbs and settings titles translated.
 * It sits inside `<I18nProvider>`, so a language change re-renders it and the
 * frame's own text follows the picker with everything else.
 */
export function LocalisedAppFrame(
  props: Omit<ComponentProps<typeof AppFrame>, "strings" | "locale">,
) {
  const { i18n } = useLingui();
  const strings = useFrameStrings();
  const { locale } = i18n;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the catalog changes with `locale`, while `i18n` stays the same object
  const plugins = useMemo(
    () => localisePlugins(props.plugins, i18n),
    [props.plugins, i18n, locale],
  );
  return (
    <AppFrame {...props} plugins={plugins} strings={strings} locale={locale} />
  );
}

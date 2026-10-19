import { useLingui } from "@lingui/react/macro";
import { AppFrame } from "@picoframe/frame";
import type { ComponentProps } from "react";
import { useFrameStrings } from "./frameStrings";

/**
 * `AppFrame` with the active locale and the frame's translated words passed in.
 * It sits inside `<I18nProvider>`, so a language change re-renders it and the
 * frame's own text follows the picker with everything else.
 */
export function LocalisedAppFrame(
  props: Omit<ComponentProps<typeof AppFrame>, "strings" | "locale">,
) {
  const { i18n } = useLingui();
  const strings = useFrameStrings();
  return <AppFrame {...props} strings={strings} locale={i18n.locale} />;
}

import { useLingui } from "@lingui/react/macro";
import type { CustomThemeOption } from "@picoframe/frame";
import { useMemo } from "react";

/**
 * Coilbox's own bases and accents, added to picoframe's picker after its built-in
 * ones. Their CSS is in `colours.css`, so tuning or adding one needs no picoframe
 * release. Each swatch mirrors the colour's light mode key token there.
 */
export function useCoilboxColours(): {
  bases: CustomThemeOption[];
  accents: CustomThemeOption[];
} {
  const { t } = useLingui();
  return useMemo(
    () => ({
      bases: [
        { value: "phosphor", swatch: "hsl(125 45% 42%)", name: t`Phosphor` },
      ],
      accents: [
        { value: "phosphor", swatch: "hsl(130 70% 28%)", name: t`Phosphor` },
      ],
    }),
    [t],
  );
}

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
        { value: "phosphor", swatch: "hsl(135 45% 42%)", name: t`Phosphor` },
        { value: "neoncyan", swatch: "hsl(192 60% 45%)", name: t`Neon cyan` },
        { value: "neonpeach", swatch: "hsl(20 70% 58%)", name: t`Neon peach` },
        {
          value: "neonpurple",
          swatch: "hsl(282 50% 55%)",
          name: t`Neon purple`,
        },
      ],
      accents: [
        { value: "phosphor", swatch: "hsl(130 70% 28%)", name: t`Phosphor` },
        { value: "neoncyan", swatch: "hsl(195 90% 30%)", name: t`Neon cyan` },
        { value: "neonpeach", swatch: "hsl(18 85% 38%)", name: t`Neon peach` },
        {
          value: "neonpurple",
          swatch: "hsl(280 65% 45%)",
          name: t`Neon purple`,
        },
      ],
    }),
    [t],
  );
}

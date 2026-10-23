import type { Accent, Base } from "@picoframe/frame";

/**
 * picoframe's `ACCENTS` and `BASES` swatch lists. `@picoframe/frame` 0.10 does
 * not export them, so they are copied from its `context/themeConfig.ts`. The
 * checks below fail the typecheck if picoframe adds a value this copy lacks.
 */
export const ACCENT_OPTIONS = [
  { value: "neutral", swatch: "hsl(240 6% 16%)" },
  { value: "blue", swatch: "hsl(221 83% 53%)" },
  { value: "green", swatch: "hsl(142 76% 36%)" },
  { value: "rose", swatch: "hsl(347 77% 50%)" },
  { value: "violet", swatch: "hsl(262 83% 58%)" },
  { value: "orange", swatch: "hsl(25 95% 53%)" },
  { value: "red", swatch: "hsl(0 72% 51%)" },
  { value: "amber", swatch: "hsl(38 92% 50%)" },
  { value: "yellow", swatch: "hsl(48 96% 53%)" },
  { value: "teal", swatch: "hsl(173 80% 32%)" },
  { value: "cyan", swatch: "hsl(192 91% 34%)" },
  { value: "sky", swatch: "hsl(200 90% 40%)" },
  { value: "indigo", swatch: "hsl(243 75% 59%)" },
  { value: "purple", swatch: "hsl(271 76% 53%)" },
  { value: "pink", swatch: "hsl(330 75% 47%)" },
  {
    value: "rainbow",
    swatch:
      "linear-gradient(90deg, hsl(350 70% 50%), hsl(48 70% 46%), hsl(150 55% 40%), hsl(200 70% 45%), hsl(320 60% 52%))",
  },
  {
    value: "opal",
    swatch:
      "linear-gradient(135deg, hsl(180 60% 86%), hsl(280 55% 89%), hsl(330 60% 89%), hsl(50 65% 87%))",
  },
] as const satisfies readonly { value: Accent; swatch: string }[];

export const BASE_OPTIONS = [
  { value: "zinc", swatch: "hsl(240 6% 55%)" },
  { value: "slate", swatch: "hsl(215 16% 55%)" },
  { value: "gray", swatch: "hsl(220 4% 55%)" },
  { value: "stone", swatch: "hsl(30 10% 55%)" },
  { value: "neutral", swatch: "hsl(0 0% 55%)" },
  { value: "rose", swatch: "hsl(345 22% 58%)" },
  { value: "red", swatch: "hsl(2 24% 58%)" },
  { value: "amber", swatch: "hsl(40 26% 55%)" },
  { value: "green", swatch: "hsl(150 18% 52%)" },
  { value: "teal", swatch: "hsl(185 20% 52%)" },
  { value: "blue", swatch: "hsl(214 26% 58%)" },
  { value: "indigo", swatch: "hsl(250 22% 60%)" },
  { value: "violet", swatch: "hsl(276 22% 60%)" },
  { value: "purple", swatch: "hsl(280 45% 55%)" },
  { value: "sky", swatch: "hsl(208 55% 50%)" },
  { value: "navy", swatch: "hsl(225 60% 38%)" },
  { value: "fuchsia", swatch: "hsl(330 45% 55%)" },
  { value: "orange", swatch: "hsl(25 50% 52%)" },
  { value: "lime", swatch: "hsl(95 38% 45%)" },
  { value: "emerald", swatch: "hsl(160 45% 40%)" },
  { value: "yellow", swatch: "hsl(50 60% 48%)" },
  { value: "crimson", swatch: "hsl(350 55% 48%)" },
] as const satisfies readonly { value: Base; swatch: string }[];

type Missing<All, Listed> = [Exclude<All, Listed>] extends [never]
  ? true
  : Exclude<All, Listed>;
const everyAccent: Missing<Accent, (typeof ACCENT_OPTIONS)[number]["value"]> =
  true;
const everyBase: Missing<Base, (typeof BASE_OPTIONS)[number]["value"]> = true;
void everyAccent;
void everyBase;

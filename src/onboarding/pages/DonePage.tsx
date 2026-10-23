import { useLingui } from "@lingui/react/macro";
import { useTheme } from "@picoframe/frame";
import type { ReactNode } from "react";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import { useFrameStrings } from "@/i18n/frameStrings";
import { useResolvedLocale } from "@/i18n/language";
import { localeDisplayName } from "@/i18n/locales";
import { useWizardDownloads } from "../OnboardingProvider";
import type { WizardPageProps } from "./registry";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-1.5">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** What the run set up, and the downloads still going in the background. */
export default function DonePage(_: WizardPageProps) {
  const { t } = useLingui();
  const locale = useResolvedLocale();
  const { mode, base, accent } = useTheme();
  const downloads = useWizardDownloads();
  // The same names the Appearance settings section shows.
  const strings = useFrameStrings();
  const modeName = {
    light: strings.light,
    dark: strings.dark,
    system: strings.system,
  }[mode];
  const baseName = strings.baseNames?.[base] ?? base;
  const accentName = strings.accentNames?.[accent] ?? accent;
  const games = downloads
    .filter((item) => !item.kind.startsWith("engine"))
    .map((item) => item.label);

  return (
    <div className="text-sm">
      <Row label={t`Language`}>{localeDisplayName(locale)}</Row>
      <Row
        label={t`Appearance`}
      >{t`${modeName}, ${baseName} / ${accentName}`}</Row>
      <Row label={t`Games`}>
        {games.length > 0 ? games.join(", ") : t`None chosen`}
      </Row>
      {downloads.map((item) => (
        <Row key={item.id} label={item.label}>
          <QueueProgress item={item} />
        </Row>
      ))}
    </div>
  );
}

import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { useEffect } from "react";
import { useLanguageSetting, useResolvedLocale } from "@/i18n/language";
import { LOCALES, resolveLocaleTag } from "@/i18n/locales";
import { languageLabel, packOnlyLocales } from "@/i18n/packs";
import type { WizardPageProps } from "./registry";

/**
 * One button per locale with a catalog, then one per language a profile's
 * language pack adds. The pseudo-locale is a developer's
 * check, so it stays in the Settings picker and never shows here. A pick is
 * written straight away, so the app, and the wizard's title with it, switches
 * language at once. Until then the selection is the locale the app already
 * runs in, which is the system's, and Continue writes "system", so the app
 * keeps following the system language as the Settings picker's option does.
 * A profile's `defaultLocale` replaces "system" there, and Continue writes it.
 */
export default function LanguagePage({ beforeContinue }: WizardPageProps) {
  const { t } = useLingui();
  const [language, setLanguage] = useLanguageSetting();
  const selected = useResolvedLocale();
  const system = resolveLocaleTag(navigator.language);

  useEffect(() => {
    beforeContinue.current = () => {
      setLanguage(language);
    };
    return () => {
      beforeContinue.current = null;
    };
  }, [beforeContinue, language, setLanguage]);

  return (
    <div className="grid grid-cols-4 gap-2.5">
      {[...LOCALES, ...packOnlyLocales()].map((code) => (
        <Button
          key={code}
          variant="outline"
          aria-pressed={code === selected}
          onClick={() => setLanguage(code)}
          className={cn(
            "h-auto flex-col items-start gap-0.5 rounded-lg bg-card p-3 text-left",
            code === selected &&
              "border-primary ring-1 ring-primary ring-inset",
          )}
        >
          <span lang={code}>{languageLabel(code)}</span>
          {code === system && (
            <span className="text-xs font-normal text-muted-foreground">
              {t`Matches your system`}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}

import { useLingui } from "@lingui/react/macro";
import { cn, type ThemeMode, useTheme } from "@picoframe/frame";
import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useFrameStrings } from "@/i18n/frameStrings";
import { getProfile } from "@/profile/profile";
import type { WizardPageProps } from "./registry";
import { ACCENT_OPTIONS, BASE_OPTIONS } from "./themeOptions";

const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Swatches<V extends string>({
  label,
  options,
  names,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; swatch: string }[];
  names: Partial<Record<V, string>> | undefined;
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <Row label={label}>
      <RadioGroup
        aria-label={label}
        value={value}
        onValueChange={(picked) => {
          const option = options.find((o) => o.value === picked);
          if (option) onChange(option.value);
        }}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const name = names?.[option.value] ?? option.value;
          return (
            <RadioGroupItem
              key={option.value}
              value={option.value}
              aria-label={name}
              title={name}
              style={{ background: option.swatch }}
              className="size-6 border-border ring-offset-2 ring-offset-background data-[state=checked]:ring-2 data-[state=checked]:ring-foreground [&_svg]:hidden"
            />
          );
        })}
      </RadioGroup>
    </Row>
  );
}

/**
 * Mode, base and accent, each applied to the whole window as it is picked. A
 * row the distribution's profile forces is left out, since a pick there would
 * be overwritten on the next launch.
 */
export default function AppearancePage(_: WizardPageProps) {
  const { t } = useLingui();
  const strings = useFrameStrings();
  const { mode, setMode, base, setBase, accent, setAccent } = useTheme();
  const profile = getProfile();
  const modeLocked = !!profile.mode;
  const coloursLocked = !!(profile.accent || profile.base);
  const id = useId();
  const modeNames: Record<ThemeMode, string | undefined> = {
    light: strings.light,
    dark: strings.dark,
    system: strings.system,
  };
  const themeLabel = strings.theme ?? t`Theme`;
  const baseLabel = strings.baseColor ?? t`Base color`;
  const accentLabel = strings.accentColor ?? t`Accent color`;

  return (
    <div className="flex flex-col gap-4">
      {modeLocked && (
        <p className="text-sm text-muted-foreground">
          {t`Light or dark is set by this distribution`}
        </p>
      )}
      {coloursLocked && (
        <p className="text-sm text-muted-foreground">
          {t`Colours are set by this distribution`}
        </p>
      )}
      {!modeLocked && (
        <Row label={themeLabel}>
          <RadioGroup
            aria-label={themeLabel}
            value={mode}
            onValueChange={(picked) => {
              const next = MODES.find((m) => m === picked);
              if (next) setMode(next);
            }}
            className="inline-flex gap-0 overflow-hidden rounded-lg border border-border"
          >
            {MODES.map((m) => (
              <Label
                key={m}
                htmlFor={`${id}-${m}`}
                className={cn(
                  "cursor-pointer px-3.5 py-2 font-normal",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset",
                  m === mode && "bg-primary text-primary-foreground",
                )}
              >
                <RadioGroupItem
                  id={`${id}-${m}`}
                  value={m}
                  className="sr-only"
                />
                {modeNames[m] ?? m}
              </Label>
            ))}
          </RadioGroup>
        </Row>
      )}
      {!coloursLocked && (
        <>
          <Swatches
            label={baseLabel}
            options={BASE_OPTIONS}
            names={strings.baseNames}
            value={base}
            onChange={setBase}
          />
          <Swatches
            label={accentLabel}
            options={ACCENT_OPTIONS}
            names={strings.accentNames}
            value={accent}
            onChange={setAccent}
          />
        </>
      )}
    </div>
  );
}

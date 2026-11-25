import { useLingui } from "@lingui/react/macro";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import type { PlayTarget } from "@/play/config";

/** The select's value for "no override". Radix refuses an empty string. */
const PREFERRED = "preferred";

/** An engine's name in the list, with its folder when two share a version. */
export function engineLabel(target: PlayTarget, all: PlayTarget[]): string {
  const twin = all.some(
    (o) =>
      o.enginePath !== target.enginePath &&
      o.engineVersion === target.engineVersion,
  );
  return twin
    ? `${target.engineVersion} (${target.enginePath})`
    : target.engineVersion;
}

/**
 * Which engine Singleplayer launches: the preferred one from Settings, or any
 * other installed engine for this setup only. `value` is an engine folder, or
 * "" for the preferred engine.
 */
export function EngineOverrideField({
  value,
  preferred,
  targets,
  onChange,
  disabled,
}: {
  value: string;
  preferred: PlayTarget | null;
  targets: PlayTarget[];
  onChange: (enginePath: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const preferredVersion = preferred?.engineVersion ?? t`none installed`;
  // A saved pick whose engine has since gone reads as the preferred engine,
  // which is what the page launches with.
  const known = targets.some((o) => o.enginePath === value);
  return (
    <Field label={t`Engine`}>
      <OptionSelect
        value={known ? value : PREFERRED}
        disabled={disabled}
        onValueChange={(v) => onChange(v === PREFERRED ? "" : v)}
        options={[
          {
            value: PREFERRED,
            label: t`Preferred engine (${preferredVersion})`,
          },
          ...targets.map((o) => ({
            value: o.enginePath,
            label: engineLabel(o, targets),
          })),
        ]}
      />
    </Field>
  );
}

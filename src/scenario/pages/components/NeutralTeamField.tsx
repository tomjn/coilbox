import { useLingui } from "@lingui/react/macro";
import { CheckField } from "@/components/Field";
import { hexToRgb, rgbToHex } from "@/play/participants";
import { NEUTRAL_DEFAULT_COLOR, type ScenarioNeutral } from "../../model";

/** Turns the scenario's neutral team on or off, and picks its colour. */
export function NeutralTeamField({
  neutral,
  onChange,
}: {
  neutral: ScenarioNeutral | undefined;
  onChange: (next: ScenarioNeutral | undefined) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex items-center gap-3">
      <CheckField
        label={t`Neutral team`}
        checked={!!neutral}
        onChange={(on) =>
          onChange(on ? { color: NEUTRAL_DEFAULT_COLOR } : undefined)
        }
      />
      {neutral && (
        <input
          type="color"
          aria-label={t`Neutral team colour`}
          value={rgbToHex(neutral.color)}
          onChange={(e) => onChange({ color: hexToRgb(e.target.value) })}
          className="color-swatch size-6 shrink-0 cursor-pointer rounded border border-white/25 bg-transparent p-0"
        />
      )}
    </div>
  );
}

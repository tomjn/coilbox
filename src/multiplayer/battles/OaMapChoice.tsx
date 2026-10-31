import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { describeError } from "@/i18n/uiError";
import { type OaMap, playOaMaps } from "../../play/bindings";
import { OA_UNPICKED_MAP } from "../oaHost";

/** What the select holds while no map is picked, as it takes no empty value. */
const UNPICKED = "__unpicked__";

/**
 * The map choice of an Open Annihilation battle (issue #4946): one of the maps
 * the program at `path` has installed, or none, which leaves the choice to OA's
 * own room. `value` is the picked map's shown name, or `""` for none. A list
 * that will not load says so and leaves hosting without a map possible.
 */
export function OaMapChoice({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (shownName: string) => void;
}) {
  const { t } = useLingui();
  const [maps, setMaps] = useState<OaMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setMaps(null);
    setError(null);
    playOaMaps({ path }).then(
      (r) => current && setMaps(r.maps),
      (e) => current && setError(describeError(e)),
    );
    return () => {
      current = false;
    };
  }, [path]);

  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association)
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        <Trans>Map</Trans>
      </span>
      <OptionSelect
        value={value || UNPICKED}
        onValueChange={(v) => onChange(v === UNPICKED ? "" : v)}
        options={[
          { value: UNPICKED, label: OA_UNPICKED_MAP },
          ...(maps ?? []).map((m) => ({
            value: m.shownName,
            label: m.shownName,
          })),
        ]}
        placeholder={maps === null && !error ? t`Reading maps…` : undefined}
        size="sm"
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

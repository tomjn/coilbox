import { useLingui } from "@lingui/react/macro";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FEATURES, type Feature, useFeatureSetting } from "./features";

/**
 * One switch per feature toggle, with the tools each one shows. Used by General
 * settings and by the setup wizard, so both name the features the same way.
 */
export function FeatureToggles() {
  return (
    <div className="space-y-3">
      {FEATURES.map((feature) => (
        <FeatureSwitch key={feature} feature={feature} />
      ))}
    </div>
  );
}

function useFeatureText(feature: Feature): { label: string; tools: string } {
  const { t } = useLingui();
  switch (feature) {
    case "mapping":
      return {
        label: t`Mapping tools`,
        tools: t`Map projects, compiling and decompiling maps`,
      };
    case "units":
      return {
        label: t`Unit tools`,
        tools: t`Unit models, Lego parts and unit tweaks`,
      };
    case "animation":
      return {
        label: t`Animation tools`,
        tools: t`BOS to Lua, COB tools and Skeletor`,
      };
    case "archives":
      return {
        label: t`Archives and Rapid`,
        tools: t`The archive explorer and Rapid repositories`,
      };
    case "missions":
      return {
        label: t`Mission builders`,
        tools: t`The scenario and campaign builders`,
      };
    case "uberstress":
      return {
        label: t`Uberstress`,
        tools: t`Engine stress tests and their history`,
      };
  }
}

function FeatureSwitch({ feature }: { feature: Feature }) {
  const [enabled, setEnabled] = useFeatureSetting(feature);
  const { label, tools } = useFeatureText(feature);
  const id = `feature-${feature}`;
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 font-normal"
    >
      <Switch
        id={id}
        checked={enabled}
        onCheckedChange={(v) => setEnabled(v === true)}
        className="mt-0.5"
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{tools}</span>
      </span>
    </Label>
  );
}

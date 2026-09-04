import { useEffect } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogos } from "@/factions/logos";
import { useUnitsyncGameInfo } from "../../../content/config";
import { shapeClipPath } from "../../galaxy3d/factionShape";
import { HUD_ACCENT_INK } from "./hudChrome";

/** Small coloured swatch for a faction, matching its map marker shape
 * (`sides` from `factionSides`; omitted/0 = circle). */
export function FactionDot({
  color,
  sides,
}: {
  color: string;
  sides?: number;
}) {
  const clipPath = sides ? shapeClipPath(sides) : undefined;
  return (
    <span
      className={`inline-block size-2 shrink-0 ${clipPath ? "" : "rounded-full"}`}
      style={{ backgroundColor: color, clipPath }}
      aria-hidden
    />
  );
}

/**
 * In-game side (Arm/Core/...) choice for the player's participant, from the
 * installed game's enumerated sides. Renders nothing while the game isn't
 * installed/loaded or has fewer than two sides — the engine default is fine
 * then, so the choice auto-skips.
 */
export function SidePicker({
  enginePath,
  dataDir,
  gameArchive,
  value,
  onChange,
}: {
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  value: string;
  onChange: (side: string) => void;
}) {
  const { info } = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const sides = info?.sides ?? [];
  const logos = useFactionLogos({
    enginePath,
    dataDir,
    gameArchive,
    sideNames: sides.map((s) => s.name),
    size: 18,
  });
  // Default to the first real side rather than a bare "engine default" — the
  // engine default *is* the first side, so show it selected by name.
  useEffect(() => {
    if (!value && sides.length > 0) onChange(sides[0].name);
  }, [value, sides, onChange]);
  if (sides.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={`font-display text-[10px] font-medium uppercase tracking-[0.2em] ${HUD_ACCENT_INK.teal}`}
      >
        Side
      </span>
      <OptionSelect
        value={value}
        onValueChange={onChange}
        options={sides.map((s) => {
          const logo = logos[s.name.toLowerCase()];
          return {
            value: s.name,
            label: s.name,
            icon: logo ? (
              <FactionLogo logo={logo} sideName={s.name} size={16} />
            ) : undefined,
          };
        })}
        size="sm"
      />
    </div>
  );
}

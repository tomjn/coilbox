import { useUnitsyncGameInfo } from "../../../content/config";
import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";
import { shapeClipPath } from "../../galaxy3d/factionShape";

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
  if (sides.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">Side</span>
      <OptionSelect
        value={value}
        onValueChange={onChange}
        placeholder={`Engine default (${sides[0]?.name ?? "first side"})`}
        options={sides.map((s) => ({ value: s.name, label: s.name }))}
        size="sm"
      />
    </div>
  );
}

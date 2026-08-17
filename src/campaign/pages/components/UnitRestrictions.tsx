import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  invalidateGameInfo,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "@/content/config";
import { UnitPicker } from "@/content/pages/components/UnitPicker";
import { unknownSelected } from "@/content/techForest";
import { usePreferredTarget } from "@/play/config";
import { allowedFromBans, bansFromAllowed } from "../../unitBans";

// Neutral about what is being edited: the same editor is a campaign mission's
// restrictions and a hosted battle's.
const HELPER =
  "Ticked units are allowed. Untick a unit to ban it, which the engine applies to ALL teams including enemy AI. Unknown unit names are silently ignored by the engine.";

/**
 * Editor for a mission's engine-level unit restrictions, over the shared
 * {@link UnitPicker}.
 *
 * A ticked unit is one the mission allows, so every unit starts ticked and the
 * author unticks what to ban. The mission still stores the bans, as internal
 * names in `disabledUnits`, so nothing on disk changes and older campaigns load
 * as they always did: the complement is taken here, at the edge (#1051).
 *
 * A ban naming a unit this game does not have cannot be a checkbox, so those are
 * listed under the picker as removable tags rather than dropped.
 *
 * When the graph can't be built the fallback distinguishes WHY: scan failure,
 * game not in the scanned content, or unitsync returning no units (typically the
 * game's own gamedata Lua erroring under unitsync's defs parser, e.g. an
 * unguarded `Spring.GetModOptions()`, with the worker's error surfaced verbatim).
 * It offers the matching retry. Already-set restrictions stay editable as plain
 * removable tags in every fallback state.
 */
export function UnitRestrictions({
  gameName,
  disabledUnits,
  onChange,
}: {
  gameName: string;
  disabledUnits: string[];
  onChange: (next: string[]) => void;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const game = scan.data?.games.find((g) => g.name === gameName) ?? null;
  const gameInfo = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const dataset = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const units = dataset.dataset?.units ?? [];
  // Faction blocks. Fall back to nothing when sides are unknown, and the picker
  // shows one unheaded list instead.
  const factions = useMemo(
    () =>
      (gameInfo.info?.sides ?? [])
        .filter((s) => !!s.startUnit)
        .map((s) => ({ startUnit: s.startUnit as string, name: s.name })),
    [gameInfo.info],
  );

  const removeUnit = (name: string) =>
    onChange(disabledUnits.filter((n) => n !== name));

  // The picker ticks what the mission allows, the mission stores what it bans.
  const knownIds = useMemo(
    () => units.map((u) => u.name.toLowerCase()),
    [units],
  );
  const allowed = useMemo(
    () => allowedFromBans(knownIds, disabledUnits),
    [knownIds, disabledUnits],
  );
  const bannedUnknown = useMemo(
    () => unknownSelected(disabledUnits, new Set(knownIds)),
    [disabledUnits, knownIds],
  );
  const setAllowed = (next: string[]) =>
    onChange(bansFromAllowed(knownIds, next, disabledUnits));

  // The scan/info is still resolving, so show a spinner rather than the fallback.
  const resolving = scan.loading || gameInfo.loading || dataset.loading;
  // No unit graph to offer: work out why, so the fallback can say so and offer
  // the retry that actually addresses it.
  const unavailable = !resolving && (!game || units.length === 0);
  const infoError = gameInfo.info?.errors?.[0];

  if (unavailable) {
    let reason: string;
    let action: { label: string; onClick: () => void };
    if (scan.error) {
      reason = `The content scan failed: ${scan.error}`;
      action = { label: "Retry scan", onClick: () => scan.run(true) };
    } else if (!game) {
      reason = `The game wasn't found in the scanned content of the current play target — it may live in a different content folder or still need installing.`;
      action = { label: "Rescan content", onClick: () => scan.run(true) };
    } else {
      reason = infoError
        ? `unitsync couldn't enumerate its units — the game's own def files errored while loading: ${infoError}`
        : "unitsync reported no units for this game.";
      action = {
        label: "Reload units",
        onClick: () => {
          invalidateGameInfo(
            target?.enginePath,
            target?.dataDir,
            game?.primaryArchive.name,
          );
          gameInfo.reload();
          dataset.reload();
        },
      };
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{HELPER}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{gameName || "(unset)"}</span>: {reason}{" "}
          Existing restrictions are still editable below.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </div>
        {disabledUnits.length === 0 ? (
          <p className="text-xs text-muted-foreground">No restrictions.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {disabledUnits.map((name) => (
              <Badge
                key={name}
                asChild
                variant="ghost"
                className="rounded bg-muted px-2 py-1 text-xs"
              >
                <li>
                  <span className="font-mono">{name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => removeUnit(name)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              </Badge>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{HELPER}</p>
      {resolving ? (
        <p className="text-xs text-muted-foreground">Loading units…</p>
      ) : (
        <UnitPicker
          units={units}
          factions={factions}
          selected={allowed}
          onChange={setAllowed}
          selectedLabel="allowed"
          enginePath={target?.enginePath}
          dataDir={target?.dataDir}
          gameArchive={game?.primaryArchive.name}
        />
      )}
      {!resolving && bannedUnknown.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Banned but not in this game ({bannedUnknown.length}), kept from the
            saved mission.
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {bannedUnknown.map((name) => (
              <Badge
                key={name}
                asChild
                variant="ghost"
                className="rounded bg-muted px-2 py-1 text-xs"
              >
                <li>
                  <span className="font-mono">{name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => removeUnit(name)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              </Badge>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

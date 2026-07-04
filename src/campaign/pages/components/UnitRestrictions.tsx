import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  invalidateGameInfo,
  useUnitsyncGameInfo,
  useUnitsyncScan,
} from "@/content/config";
import { usePreferredTarget } from "@/play/config";

const HELPER =
  "Restrictions are engine-level and apply to ALL teams including enemy AI. Unknown unit names are silently ignored by the engine.";

/**
 * Editor for a mission's engine-level unit restrictions. Lists every unit of the
 * mission's game (resolved from unitsync via the preferred engine) as a filterable
 * checkbox list; a checked unit is disabled and stored by its internal name in
 * `disabledUnits`.
 *
 * When the list can't be built the fallback distinguishes WHY — scan failure,
 * game not in the scanned content, or unitsync returning no units (typically the
 * game's own gamedata Lua erroring under unitsync's defs parser, e.g. an
 * unguarded `Spring.GetModOptions()`; the worker's error is surfaced verbatim) —
 * and offers the matching retry. Already-set restrictions stay editable as plain
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
  const units = gameInfo.info?.units ?? [];

  const [query, setQuery] = useState("");
  const disabledSet = useMemo(() => new Set(disabledUnits), [disabledUnits]);

  const toggle = (name: string, on: boolean) => {
    if (on) {
      if (!disabledSet.has(name)) onChange([...disabledUnits, name]);
    } else {
      onChange(disabledUnits.filter((n) => n !== name));
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return units;
    return units.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.fullName?.toLowerCase().includes(q),
    );
  }, [units, query]);

  // The scan/info is still resolving — show a spinner rather than the fallback.
  const resolving = scan.loading || gameInfo.loading;
  // No unit list to offer: work out why, so the fallback can say so and offer
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
          <p className="text-xs text-muted-foreground/80">No restrictions.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {disabledUnits.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
              >
                <span className="font-mono">{name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => toggle(name, false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{HELPER}</p>
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search units…"
          className="h-8"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {disabledUnits.length} disabled
        </span>
      </div>
      {resolving ? (
        <p className="text-xs text-muted-foreground">Loading units…</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-auto rounded-md border border-border/50 p-1">
          {filtered.map((u) => (
            <li key={u.name}>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control (implicit label association) */}
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60">
                <Checkbox
                  checked={disabledSet.has(u.name)}
                  onCheckedChange={(v) => toggle(u.name, v === true)}
                />
                <span className="truncate">{u.fullName || u.name}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  {u.name}
                </span>
              </label>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              No units match.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

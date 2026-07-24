import { Input, useDrawer } from "@picoframe/frame";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { SkirmishPreset } from "@/play/presets";

/**
 * Drawer body listing the user's saved skirmish presets so one can be attached to
 * a campaign as a new mission. Picking a preset hands it back via `onPick`; the
 * caller deep-copies the preset's setup into the mission snapshot.
 */
export function PresetPickerDrawer({
  presets,
  onPick,
  initialGameName,
}: {
  presets: SkirmishPreset[];
  onPick: (preset: SkirmishPreset) => void;
  /**
   * Scope the list to this game's presets by default (game detail's "New
   * campaign" action, issue #372). The user can still clear it to see every
   * preset.
   */
  initialGameName?: string;
}) {
  const drawer = useDrawer();
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState(initialGameName);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return presets.filter((p) => {
      if (gameFilter && p.gameName !== gameFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [presets, query, gameFilter]);

  if (presets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No skirmish presets yet. Set up a game on the{" "}
        <Link
          className="font-medium underline underline-offset-4"
          to="/play/skirmish"
          onClick={() => drawer.close()}
        >
          Play → Singleplayer
        </Link>{" "}
        screen and save it as a preset, then attach it here as a mission.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {gameFilter && (
        <p className="text-xs text-muted-foreground">
          Showing presets for{" "}
          <span className="text-foreground">{gameFilter}</span>.{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setGameFilter(undefined)}
          >
            Show all
          </button>
        </p>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search presets…"
        className="h-8"
      />
      <ul className="flex flex-col gap-1.5">
        {filtered.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                onPick(p);
                drawer.close();
              }}
              className="flex w-full flex-col gap-0.5 rounded-md border border-border/50 bg-card p-3 text-left hover:border-border hover:bg-muted/40"
            >
              <span className="truncate text-sm font-medium">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {p.gameName || "No game"} · {p.mapName || "No map"} ·{" "}
                {p.participants.length} participant
                {p.participants.length === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && gameFilter && (
          <li className="text-xs text-muted-foreground">
            No presets for {gameFilter}.{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setGameFilter(undefined)}
            >
              Show all
            </button>
          </li>
        )}
        {filtered.length === 0 && !gameFilter && (
          <li className="text-xs text-muted-foreground">No presets match.</li>
        )}
      </ul>
    </div>
  );
}

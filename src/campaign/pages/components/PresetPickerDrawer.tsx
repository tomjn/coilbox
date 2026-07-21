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
}: {
  presets: SkirmishPreset[];
  onPick: (preset: SkirmishPreset) => void;
}) {
  const drawer = useDrawer();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) => p.name.toLowerCase().includes(q));
  }, [presets, query]);

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
        {filtered.length === 0 && (
          <li className="text-xs text-muted-foreground">No presets match.</li>
        )}
      </ul>
    </div>
  );
}

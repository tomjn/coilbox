import { Input, useDrawer } from "@picoframe/frame";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { playableScenarios, scenarioContents } from "@/scenario/listing";
import type { Scenario } from "@/scenario/model";

/**
 * Choosing a scenario to attach to a campaign mission. The preset picker beside
 * it, for the other half of a mission.
 *
 * The list is a component of its own because it is reached two ways: through the
 * app's shared drawer when adding a mission, and through a popover when
 * attaching one from *inside* the mission editor drawer, which cannot open a
 * second drawer without replacing itself.
 *
 * Only scenarios that name a game and a map are offered, because attaching one
 * sets the mission's game and map from it.
 */
export function ScenarioPickerList({
  scenarios,
  onPick,
  onNavigate,
  /** Scope the list to this game by default, with a way back to all of them. */
  initialGameName,
}: {
  scenarios: Scenario[];
  onPick: (scenario: Scenario) => void;
  /** Called when a link out of the picker is followed, to close the surface. */
  onNavigate?: () => void;
  initialGameName?: string;
}) {
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState(initialGameName);

  const playable = useMemo(() => playableScenarios(scenarios), [scenarios]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return playable.filter((s) => {
      if (gameFilter && s.setup.gameName !== gameFilter) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [playable, query, gameFilter]);

  if (playable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No scenarios are ready to attach. Build one in the{" "}
        <Link
          className="font-medium underline underline-offset-4"
          to="/scenario-builder"
          onClick={onNavigate}
        >
          Scenario Builder
        </Link>{" "}
        and give it a game and a map first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {gameFilter && (
        <p className="text-xs text-muted-foreground">
          Showing scenarios for{" "}
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
        placeholder="Search scenarios…"
        className="h-8"
      />
      <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto">
        {filtered.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full flex-col gap-0.5 rounded-md border border-border/50 bg-card p-3 text-left hover:border-border hover:bg-muted/40"
            >
              <span className="truncate text-sm font-medium">{s.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {s.setup.gameName} · {s.setup.mapName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {scenarioContents(s)}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && gameFilter && (
          <li className="text-xs text-muted-foreground">
            No scenarios for {gameFilter}.{" "}
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
          <li className="text-xs text-muted-foreground">No scenarios match.</li>
        )}
      </ul>
    </div>
  );
}

/** The picker as the app's shared drawer, for adding a mission from a scenario. */
export function ScenarioPickerDrawer({
  scenarios,
  onPick,
  initialGameName,
}: {
  scenarios: Scenario[];
  onPick: (scenario: Scenario) => void;
  initialGameName?: string;
}) {
  const drawer = useDrawer();
  return (
    <ScenarioPickerList
      scenarios={scenarios}
      initialGameName={initialGameName}
      onNavigate={() => drawer.close()}
      onPick={(scenario) => {
        onPick(scenario);
        drawer.close();
      }}
    />
  );
}

import { Button, Input } from "@picoframe/frame";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import type { mpCreateLobby } from "../bindings";
import {
  ALLY_TEAM_RANGE,
  newLobbyProblem,
  PLAYERS_PER_TEAM_RANGE,
  shapeLabel,
} from "./createLobby";

/** The `mpCreateLobby` argument shape, minus the connection key the parent supplies. */
export type CreateLobbyArgs = Omit<
  Parameters<typeof mpCreateLobby>[0],
  "serverKey"
>;

/**
 * "Create a lobby" for the Battles hub on a Tachyon server, sitting where the
 * TASServer "Host a battle" popover sits on a line-protocol one.
 *
 * The two are different things and the copy says so. Opening a battle on
 * TASServer makes this machine the host: it needs a port, a NAT mode and the
 * content hashes joiners check themselves against. A Tachyon lobby is a room the
 * server owns. Creating one puts us in it as its first player, and when any
 * member starts the match the server picks a machine from its own pool and sends
 * everyone its address. Nothing runs here, so none of those fields exist and the
 * word host appears nowhere.
 *
 * What carries over from the host popover is the title, the map picker and the
 * installed-content scan behind it. What does not: the game, which the server
 * chooses and reports back on the lobby, and the port, password and hole
 * punching, which only a host would need. The size is asked for as sides and
 * seats instead of a single total, because that is the shape `lobby/create`
 * takes.
 */
export function CreateLobbyPopover({
  disabled,
  onCreate,
  initialMap,
  autoOpen,
}: {
  disabled: boolean;
  onCreate: (args: CreateLobbyArgs) => void;
  /** Preselect this map, as a content map detail's "Host a battle here" does. */
  initialMap?: string;
  /** Open the popover on mount, paired with `initialMap` for the same jump. */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);

  // A map can appear in more than one archive, so collapse by name: the option
  // value is the name, and two entries under it would be indistinguishable.
  const maps = useMemo(
    () =>
      Array.from(
        new Map((scan.data?.maps ?? []).map((m) => [m.name, m])).values(),
      ),
    [scan.data],
  );

  const [name, setName] = useState("");
  const [mapName, setMapName] = useState(initialMap ?? "");
  const [allyTeams, setAllyTeams] = useState(2);
  const [playersPerTeam, setPlayersPerTeam] = useState(8);
  // On by default, matching the schema. A Tachyon lobby has no founder, so a
  // boss is the only way anyone gets to change it once it is running.
  const [bossesEnabled, setBossesEnabled] = useState(true);

  // Default the map to the first scanned one once a scan lands.
  useEffect(() => {
    if (maps.length > 0)
      setMapName((c) => (maps.some((m) => m.name === c) ? c : maps[0].name));
  }, [maps]);

  const shape = shapeLabel(allyTeams, playersPerTeam);
  const problem = newLobbyProblem({ name, mapName, allyTeams, playersPerTeam });
  const noEngine = !target && !scan.loading;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    onCreate({
      name: name.trim(),
      mapName,
      allyTeams,
      playersPerTeam,
      bossesEnabled,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="h-8 px-3" disabled={disabled}>
          Create a lobby
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <span className="text-sm font-semibold">Create a lobby</span>
          <p className="text-xs text-muted-foreground">
            A lobby is a room players gather in. When anyone in it starts the
            match, the server picks a machine to run the game and sends everyone
            its address. Your machine does not run it, so there is nothing to
            forward and no password to set.
          </p>

          {noEngine ? (
            <p className="text-sm text-muted-foreground">
              No engine found. Add a content folder with an engine in{" "}
              <Link
                className="font-medium underline underline-offset-4"
                to="/settings/content-folders"
              >
                Settings → Content Folders
              </Link>{" "}
              first.
            </p>
          ) : (
            <>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Name</span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${shape} on ${mapName || "any map"}`}
                />
              </label>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Map</span>
                <OptionSelect
                  value={mapName}
                  onValueChange={setMapName}
                  options={maps.map((m) => ({ value: m.name, label: m.name }))}
                  placeholder={scan.loading ? "Scanning…" : "Select a map"}
                  size="sm"
                />
              </label>

              <div className="flex gap-2">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="font-medium">Sides</span>
                  <Input
                    type="number"
                    min={ALLY_TEAM_RANGE.min}
                    max={ALLY_TEAM_RANGE.max}
                    value={allyTeams}
                    onChange={(e) =>
                      setAllyTeams(clamp(e.target.value, ALLY_TEAM_RANGE))
                    }
                  />
                </label>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="font-medium">Players each</span>
                  <Input
                    type="number"
                    min={PLAYERS_PER_TEAM_RANGE.min}
                    max={PLAYERS_PER_TEAM_RANGE.max}
                    value={playersPerTeam}
                    onChange={(e) =>
                      setPlayersPerTeam(
                        clamp(e.target.value, PLAYERS_PER_TEAM_RANGE),
                      )
                    }
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                A {shape} lobby, with a start box for each side.
              </p>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={bossesEnabled}
                  onCheckedChange={(v) => setBossesEnabled(v === true)}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">Allow bosses</span>
                  <span className="text-xs text-muted-foreground">
                    A lobby has no owner. A boss is the member who may change
                    the map and the settings once it is running.
                  </span>
                </span>
              </label>

              {problem && (
                <p className="text-xs text-muted-foreground">{problem}</p>
              )}

              <Button type="submit" className="h-8" disabled={!!problem}>
                Create lobby
              </Button>
            </>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** A typed number held inside `range`, so the field cannot leave it. */
function clamp(raw: string, range: { min: number; max: number }): number {
  return Math.max(range.min, Math.min(range.max, Number(raw) || range.min));
}

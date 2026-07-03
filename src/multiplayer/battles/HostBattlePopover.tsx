import { Button, Input } from "@picoframe/frame";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncScan,
} from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { mpOpenBattle } from "../bindings";

/** The `mpOpenBattle` argument shape, minus the connection key the parent supplies. */
export type OpenBattleArgs = Omit<
  Parameters<typeof mpOpenBattle>[0],
  "serverKey"
>;

/** Parse a unitsync hex CRC into the signed 32-bit int the OPENBATTLE wire carries. */
function hexToI32(hex?: string): number {
  if (!hex) return 0;
  // `| 0` folds a >2^31 checksum into the signed range the server reads it back in.
  return Number.parseInt(hex, 16) | 0;
}

/** Spring's conventional lobby-host port; editable for power users / multi-host. */
const DEFAULT_HOST_PORT = 8452;

/**
 * "Host a battle" affordance for the Battles hub: a compact popover collecting the
 * game, map, title, size and (optional) password, then firing OPENBATTLE via the
 * parent's `onHost`. The engine is the preferred one (no picker), and the mod/map
 * hashes come from unitsync so joining clients can sync. With "hole punching" on
 * the battle opens as natType 1 (the server relays each joiner's IP so NATed
 * players can connect); off, it's a plain natType 0 battle that needs `port`
 * reachable (public IP, LAN, or a manual port-forward).
 */
export function HostBattlePopover({
  disabled,
  onHost,
}: {
  disabled: boolean;
  onHost: (args: OpenBattleArgs) => void;
}) {
  const [open, setOpen] = useState(false);
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  // A game or map can appear in more than one archive (e.g. a packaged `.sdz`
  // and its decompiled `.sdd`); collapse by name so each Select has one option
  // per name. The option value/key is the name, so duplicates would both violate
  // the unique-key rule and give the Select two indistinguishable entries.
  const games = useMemo(
    () =>
      Array.from(
        new Map((scan.data?.games ?? []).map((g) => [g.name, g])).values(),
      ),
    [scan.data],
  );
  const maps = useMemo(
    () =>
      Array.from(
        new Map((scan.data?.maps ?? []).map((m) => [m.name, m])).values(),
      ),
    [scan.data],
  );

  const [title, setTitle] = useState("");
  const [gameName, setGameName] = useState("");
  const [mapName, setMapName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(16);
  const [port, setPort] = useState(DEFAULT_HOST_PORT);
  const [password, setPassword] = useState("");
  // Default on: most home hosts are behind NAT, and the server-side hole punching
  // lets those players connect. Uncheck for a public IP / forwarded port.
  const [holePunch, setHolePunch] = useState(true);

  // Default the game/map to the first scanned entry once a scan lands.
  useEffect(() => {
    if (games.length > 0)
      setGameName((c) => (games.some((g) => g.name === c) ? c : games[0].name));
  }, [games]);
  useEffect(() => {
    if (maps.length > 0)
      setMapName((c) => (maps.some((m) => m.name === c) ? c : maps[0].name));
  }, [maps]);

  const selectedGame = games.find((g) => g.name === gameName);
  const gameInfo = useUnitsyncGameInfo(
    enginePath,
    dataDir,
    selectedGame?.primaryArchive.name,
  );
  const mapInfo = useUnitsyncMapInfo(enginePath, dataDir, mapName || undefined);
  const modhash = hexToI32(gameInfo.info?.checksum);
  const maphash = hexToI32(mapInfo.info?.checksum);
  // The hashes let joiners verify they have the same content; without them the
  // battle would open unsyncable, so gate hosting on both resolving.
  const checksumsReady =
    gameInfo.status === "ready" && mapInfo.status === "ready";
  // A resolved-but-unhashable checksum or a worker error is a dead end, not
  // progress — surface it (with a retry) instead of hanging on "Reading content".
  const gameFailed =
    gameInfo.status === "error" || gameInfo.status === "unsyncable";
  const mapFailed =
    mapInfo.status === "error" || mapInfo.status === "unsyncable";

  function hostButtonLabel(): string {
    if (!gameName || !mapName || checksumsReady) return "Host battle";
    if (gameInfo.status === "loading") return "Hashing game…";
    if (mapInfo.status === "loading") return "Hashing map…";
    // Both failed/idle: the button is disabled and the error row explains why.
    return "Host battle";
  }

  function failMessage(
    kind: "game" | "map",
    status: typeof gameInfo.status,
    firstError?: string,
  ): string {
    if (status === "unsyncable")
      return firstError
        ? `Couldn't hash the ${kind}: ${firstError}`
        : `Couldn't hash the ${kind} — it may be missing a dependency or be unreadable.`;
    return firstError
      ? `Failed to read the ${kind}: ${firstError}`
      : `Failed to read the ${kind}.`;
  }

  const noEngine = !target && !scan.loading;
  const canHost = !!target && !!gameName && !!mapName && checksumsReady;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canHost || !target) return;
    onHost({
      battleType: 0,
      natType: holePunch ? 1 : 0,
      key: password.trim() || "*",
      port,
      maxPlayers,
      modhash,
      rank: 0,
      maphash,
      engine: "spring",
      version: target.engineVersion,
      map: mapName,
      title: title.trim() || `${gameName} — hosted`,
      modname: gameName,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="h-8 px-3" disabled={disabled}>
          Host a battle
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <span className="text-sm font-semibold">Host a battle</span>

          {noEngine ? (
            <p className="text-sm text-muted-foreground">
              No engine found. Add a content folder with an engine in{" "}
              <span className="font-medium">Settings → Content Folders</span>{" "}
              first.
            </p>
          ) : (
            <>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Title</span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${gameName || "Game"} — hosted`}
                />
              </label>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Game</span>
                <OptionSelect
                  value={gameName}
                  onValueChange={setGameName}
                  options={games.map((g) => ({ value: g.name, label: g.name }))}
                  placeholder={scan.loading ? "Scanning…" : "Select a game"}
                  size="sm"
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
                  <span className="font-medium">Max players</span>
                  <Input
                    type="number"
                    min={2}
                    max={32}
                    value={maxPlayers}
                    onChange={(e) =>
                      setMaxPlayers(
                        Math.max(2, Math.min(32, Number(e.target.value) || 2)),
                      )
                    }
                  />
                </label>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="font-medium">Port</span>
                  <Input
                    type="number"
                    value={port}
                    onChange={(e) =>
                      setPort(Number(e.target.value) || DEFAULT_HOST_PORT)
                    }
                  />
                </label>
              </div>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Password (optional)</span>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank for an open battle"
                />
              </label>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={holePunch}
                  onCheckedChange={(v) => setHolePunch(v === true)}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    Hole punching for NAT players
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {holePunch
                      ? "The server relays each joiner's IP so players behind a router can connect. Some may still fail — forwarding port " +
                        `${port} is the reliable fallback.`
                      : `Players connect directly to port ${port}; forward it on your router or others can't join.`}
                  </span>
                </span>
              </label>

              {(gameFailed || mapFailed) && (
                <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  {gameFailed && (
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {failMessage(
                          "game",
                          gameInfo.status,
                          gameInfo.info?.errors?.[0],
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-6 shrink-0 px-2"
                        onClick={gameInfo.reload}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                  {mapFailed && (
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {failMessage(
                          "map",
                          mapInfo.status,
                          mapInfo.info?.errors?.[0],
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-6 shrink-0 px-2"
                        onClick={mapInfo.reload}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" className="h-8" disabled={!canHost}>
                {hostButtonLabel()}
              </Button>
            </>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

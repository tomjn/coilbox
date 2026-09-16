import { Button, Input, useDrawer, useSetting } from "@picoframe/frame";
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUnitsyncThumbnails } from "@/content/config";
import { MapPickerGrid } from "@/play/pages/components/MapPickerGrid";
import {
  advertisedGamePort,
  HOST_THROUGH_RELAY_KEY,
  hostingRoute,
  hostingRouteSummary,
  NAT_TYPE_DIRECT,
  RELAY_EXPLAINED,
  RELAY_MODE_KEY,
  type RelayMode,
  recordHostingRoute,
  relayModeFrom,
  relayModeMeaning,
} from "../../direct/hostingRoute";
import { ReachablePorts } from "../../direct/ReachablePorts";
import {
  battlePorts,
  type DirectReachability,
  directClosePorts,
} from "../../direct/reachability";
import { mpLeftoverRelayAgent, type mpOpenBattle } from "../bindings";
import { hostBattleFailure } from "./hostBattle";
import { hostEngineVersion } from "./hostEngineVersion";
import { LeftoverRelayAgent } from "./LeftoverRelayAgent";
import { hashFailureMessage, useHostContent } from "./useHostContent";
import { WindowsFirewall } from "./WindowsFirewall";

/** The `mpOpenBattle` argument shape, minus the connection key the parent supplies. */
export type OpenBattleArgs = Omit<
  Parameters<typeof mpOpenBattle>[0],
  "serverKey"
>;

/** Spring's conventional lobby-host port; editable for power users / multi-host. */
export const DEFAULT_HOST_PORT = 8452;

// Remembered from the last battle hosted (issue #2794), the same way as
// RELAY_MODE_KEY below. Not the password, which would sit in the settings file
// as plain text, and a host who locked one battle may not expect the next to
// be locked too.
const LAST_GAME_KEY = "multiplayer.hostBattle.lastGame";
const LAST_MAP_KEY = "multiplayer.hostBattle.lastMap";
const LAST_TITLE_KEY = "multiplayer.hostBattle.lastTitle";
const LAST_MAX_PLAYERS_KEY = "multiplayer.hostBattle.lastMaxPlayers";
const LAST_PORT_KEY = "multiplayer.hostBattle.lastPort";

/**
 * The "Host a battle" form, as shown in the frame's drawer by `HostBattleButton`.
 * It collects the game, map, title, size and optional password, then fires
 * OPENBATTLE through the parent's `onHost`. The engine is the preferred one (no
 * picker), and the mod and map hashes come from unitsync so joining clients can
 * sync.
 *
 * How the battle is reachable is worked out rather than asked about. There used
 * to be a "Hole punching for NAT players" checkbox here, which advertised
 * `natType 1` and bought a battle that looked joinable and was not, because
 * coilbox has never implemented hole punching. It is gone, and what replaced it
 * is {@link hostingRoute} reading the answer {@link ReachablePorts} already had
 * (issue #2020).
 *
 * The game, map, title, player limit and port default to whatever the host
 * hosted last time, the same way `relayMode` below remembers the relay choice
 * (issue #2794). `initialMap`/`initialGame`/`initialTitle` win over that,
 * since those come from a jump the host asked for. The password does not get
 * remembered.
 */
export function HostBattleForm({
  relayAvailable,
  onHost,
  initialMap,
  initialGame,
  initialTitle,
}: {
  /** Whether this lobby server has a relay to host through, from
   *  `relayHostingAvailable`. The bottom rung of the ladder does not exist
   *  without it. */
  relayAvailable: boolean;
  /** Rejects when the battle did not open, which is what this form shows. */
  onHost: (args: OpenBattleArgs) => Promise<void>;
  /** Preselect this map (e.g. from a content map detail's "Host a battle here"). */
  initialMap?: string;
  /** Preselect this game (e.g. from a skirmish preset's "Host as battle"). */
  initialGame?: string;
  /** Preselect this title (e.g. a skirmish preset's name). */
  initialTitle?: string;
}) {
  const drawer = useDrawer();
  // What the host picked last time (issue #2794), read once at mount. A jump
  // that opened this drawer with a map or game already chosen (`initialMap`/
  // `initialGame`) wins over it, per the jumps at `BattlesPage.tsx`.
  const [lastGame, setLastGame] = useSetting(LAST_GAME_KEY, "");
  const [lastMap, setLastMap] = useSetting(LAST_MAP_KEY, "");
  const [lastTitle, setLastTitle] = useSetting(LAST_TITLE_KEY, "");
  const [lastMaxPlayers, setLastMaxPlayers] = useSetting(
    LAST_MAX_PLAYERS_KEY,
    8,
  );
  const [lastPort, setLastPort] = useSetting(LAST_PORT_KEY, DEFAULT_HOST_PORT);
  const content = useHostContent(
    initialGame ?? lastGame,
    initialMap ?? lastMap,
  );
  const {
    target,
    games,
    maps,
    gameName,
    setGameName,
    mapName,
    setMapName,
    gameInfo,
    mapInfo,
    modhash,
    maphash,
    checksumsReady,
    gameFailed,
    mapFailed,
  } = content;
  const { thumbs } = useUnitsyncThumbnails(target?.enginePath, target?.dataDir);
  // Swaps the drawer's whole content for the map picker grid, with a back
  // button, rather than stacking a second drawer on top of the one this form
  // is already showing in (issue #2796).
  const [pickingMap, setPickingMap] = useState(false);

  const [title, setTitle] = useState(initialTitle ?? lastTitle);
  // 8 is a sensible starting size for a fresh host (issue #502) and also the
  // fallback here, the user can still raise it. A "Host as battle" draft only
  // ever carries the AIs (added as bots, not real player slots) plus the one
  // human host seat, so no preset needs this raised to fit.
  const [maxPlayers, setMaxPlayers] = useState(lastMaxPlayers);
  const [port, setPort] = useState(lastPort);
  const [password, setPassword] = useState("");
  // What the router and the internet said, handed up by ReachablePorts below.
  // Null until the check answers, and for as long as the host has it turned off,
  // which is a route decision of its own.
  const [reachability, setReachability] = useState<DirectReachability | null>(
    null,
  );
  // Why the last press did nothing. A refusal that never reaches the wire leaves
  // no join error and no disconnect, so this is the only account of it there is
  // (issue #1591).
  const [error, setError] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);
  // The router check is still running. Host waits for it, because until it
  // answers there is no evidence to pick a route with, and a press in that gap
  // would advertise the host's own address untested.
  const [checking, setChecking] = useState(false);
  // A relay agent from an earlier session, which is the one hosting failure the
  // host cannot act on from the error alone: it names a process id and nothing
  // else (issue #2062). Only ever looked for after a relayed attempt failed,
  // because it is the only attempt a leftover agent can refuse.
  const [leftover, setLeftover] = useState<{
    pid: number;
    ours: boolean;
  } | null>(null);
  // How to use the relay, when the server has one. Stored, so somebody who cares
  // about their ping says it once rather than every time they host (issue
  // #2023). A host who has never picked is on whatever the old true or false
  // preference said, so turning the relay off before there were three answers
  // still counts.
  const [relayBefore] = useSetting<boolean | null>(
    HOST_THROUGH_RELAY_KEY,
    null,
  );
  const [relayPicked, setRelayMode] = useSetting<RelayMode | null>(
    RELAY_MODE_KEY,
    null,
  );
  const relayMode = relayModeFrom(relayPicked, relayBefore);
  // Whether the battle this form was opened for has been opened. The port the
  // check asked for belongs to that battle. Closing the drawer unmounts the
  // form, and a form that goes without a battle hands the port back, rather
  // than leaving it on the router until coilbox quits.
  const hosted = useRef(false);
  useEffect(
    () => () => {
      if (!hosted.current) directClosePorts({}).catch(() => {});
    },
    [],
  );

  function hostButtonLabel(): string {
    if (hosting) return "Hosting…";
    if (checking) return "Checking your router…";
    if (!gameName || !mapName || checksumsReady) return "Host battle";
    if (gameInfo.status === "loading") return "Hashing game…";
    if (mapInfo.status === "loading") return "Hashing map…";
    // Both failed/idle: the button is disabled and the error row explains why.
    return "Host battle";
  }

  const noEngine = content.noEngine;
  const canHost = content.ready;
  const route = hostingRoute(reachability, relayAvailable, relayMode);
  // Only when there was a relay to refuse. On a server with none the host's
  // answer changed nothing, and crediting them for an outcome that was never
  // theirs would send them to a choice that cannot fix it.
  const relayDeclined = relayAvailable && relayMode === "never";
  // Every battle goes through the relay, so the router is not asked for a port
  // the battle would never use.
  const relayAlways = relayAvailable && relayMode === "always";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canHost || !target || hosting || checking) return;
    setError(null);
    setLeftover(null);
    setHosting(true);
    // Dropped before the attempt rather than after it, so a host that fails
    // leaves no route behind for the next reader to believe.
    recordHostingRoute(null);
    try {
      const version = await hostEngineVersion(target);
      await onHost({
        battleType: 0,
        natType: NAT_TYPE_DIRECT,
        key: password.trim() || "*",
        // The port a joiner dials, which is the one the engine binds unless the
        // router opened a different one and said so. On the relay route it is
        // neither: the backend advertises the relay's allocated port and takes
        // this one as where the engine listens (issue #2017).
        port: advertisedGamePort(route, reachability, port),
        relay: route === "relay",
        maxPlayers,
        modhash,
        rank: 0,
        maphash,
        engine: "spring",
        version,
        map: mapName,
        title: title.trim() || `${gameName} — hosted`,
        modname: gameName,
      });
      // Only once the battle is actually open, so nothing downstream describes a
      // route for a battle that never happened. Read back by the battle room
      // (issue #2022).
      recordHostingRoute(route);
      // Remembered for the next battle (issue #2794), except the password,
      // per the keys above.
      setLastGame(gameName);
      setLastMap(mapName);
      setLastTitle(title);
      setLastMaxPlayers(maxPlayers);
      setLastPort(port);
      hosted.current = true;
      drawer.close();
    } catch (err) {
      // Left open on purpose: the answer is in here, and the fields that need
      // changing are too.
      setError(hostBattleFailure(err));
      // Asked rather than read out of the error, because the refusal is a
      // sentence for a person and matching on its wording would break the next
      // time somebody improves it. Only after a relayed attempt: nothing else
      // consults the run file, so a leftover agent cannot be what stopped an
      // ordinary battle.
      if (route === "relay") {
        const found = await mpLeftoverRelayAgent({}).catch(() => null);
        if (found?.pid != null) {
          setLeftover({ pid: found.pid, ours: found.ours });
        }
      }
    } finally {
      setHosting(false);
    }
  }

  // The map picker takes over the whole drawer rather than opening a second
  // one on top of it (issue #2796). Picking a map, or the back button, drops
  // back to the form with every other field exactly as it was, since nothing
  // here unmounts the form's own state.
  if (pickingMap) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Back to the battle form"
            onClick={() => setPickingMap(false)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-sm font-semibold">Choose a map</h2>
        </div>
        <MapPickerGrid
          maps={maps}
          thumbs={thumbs}
          selectedName={mapName}
          onSelect={(name) => {
            setMapName(name);
            setPickingMap(false);
          }}
          mapsLoading={content.scanning}
        />
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      {noEngine ? (
        <p className="text-sm text-muted-foreground">
          No engine found. Add a content folder with an engine in{" "}
          <Link
            className="font-medium underline underline-offset-4"
            to="/settings/content-folders"
          >
            Settings → Content folders
          </Link>{" "}
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
              placeholder={content.scanning ? "Scanning…" : "Select a game"}
              size="sm"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Map</span>
            <button
              type="button"
              onClick={() => setPickingMap(true)}
              className="flex h-11 items-center gap-2 rounded-md border border-input bg-transparent px-2 text-left text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
            >
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
                {thumbs.get(mapName) ? (
                  <img
                    src={thumbs.get(mapName)?.url}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <ImageOff className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {mapName || (content.scanning ? "Scanning…" : "Select a map")}
              </span>
            </button>
          </div>

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

          <ReachablePorts
            ports={relayAlways ? null : battlePorts(port)}
            help={
              relayAlways
                ? "Not checked, because every battle you host goes through the server's relay."
                : undefined
            }
            onReport={setReachability}
            always
            relayWillCarry={route === "relay"}
            onCheckingChange={setChecking}
          />

          {/* How the relay is used, next to the answer that decides it in the
              automatic case. Only on a server that has one. On a server without,
              there is nothing to choose, and the route sentence below says so.
              This is the one place the relay's cost is written down, because
              somebody choosing needs the price and somebody reading the outcome
              has already paid it (issue #2023). */}
          {relayAvailable && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Server relay</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={relayMode}
                onValueChange={(v) => v && setRelayMode(v as RelayMode)}
                aria-label="Server relay"
                className="self-start"
              >
                <ToggleGroupItem value="auto">Automatic</ToggleGroupItem>
                <ToggleGroupItem value="always">Always</ToggleGroupItem>
                <ToggleGroupItem value="never">Never</ToggleGroupItem>
              </ToggleGroup>
              <Collapsible>
                <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronRight
                    aria-hidden
                    className="size-3 motion-safe:transition-transform group-data-[state=open]:rotate-90"
                  />
                  What are server relays?
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1.5 flex flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
                  <p>{RELAY_EXPLAINED}</p>
                  <ul className="flex flex-col gap-0.5">
                    {(
                      [
                        ["auto", "Automatic"],
                        ["always", "Always"],
                        ["never", "Never"],
                      ] as const
                    ).map(([mode, name]) => (
                      <li key={mode}>
                        <span className="font-medium text-foreground">
                          {name}
                        </span>{" "}
                        {relayModeMeaning(mode)}
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Windows Firewall, in the same cluster as the reachability check
              and the relay, because it is the third thing that decides whether
              anybody gets in. Draws nothing off Windows, and the engine goes
              with it because Windows remembers an answer per program file
              (issue #2799). */}
          <WindowsFirewall engine={target?.executable ?? null} />

          {/* What hosting is about to do, in the place where the answer it is
              reading appears. Not the same thing as issue #2022, which tells
              the people already in a battle why their ping is what it is. This
              is the host, before they commit to anything. */}
          {/* Held back while the check runs, because until it answers the
              sentence would describe a route nobody has picked. */}
          {!checking && (
            <p className="text-xs text-muted-foreground">
              {hostingRouteSummary(route, {
                lanRoom: false,
                relayDeclined,
                relayAlways,
              })}
            </p>
          )}

          {(gameFailed || mapFailed) && (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {gameFailed && (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {hashFailureMessage(
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
                    {hashFailureMessage(
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

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}

          {leftover && (
            <LeftoverRelayAgent pid={leftover.pid} ours={leftover.ours} />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => drawer.close()}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-9"
              disabled={!canHost || hosting || checking}
            >
              {(hosting || checking) && (
                <Loader2
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden
                />
              )}
              {hostButtonLabel()}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

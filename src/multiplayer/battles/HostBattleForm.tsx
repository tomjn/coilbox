import { Button, Input, useDrawer, useSetting } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  advertisedGamePort,
  HOST_THROUGH_RELAY_KEY,
  hostingRoute,
  hostingRouteSummary,
  NAT_TYPE_DIRECT,
  RELAY_MODE_KEY,
  type RelayMode,
  recordHostingRoute,
  relayModeFrom,
  relayModeHelp,
} from "../../direct/hostingRoute";
import { ReachablePorts } from "../../direct/ReachablePorts";
import {
  battlePorts,
  type DirectReachability,
  directClosePorts,
} from "../../direct/reachability";
import { mpLeftoverRelayAgent, type mpOpenBattle } from "../bindings";
import { hostBattleFailure } from "./hostBattle";
import { LeftoverRelayAgent } from "./LeftoverRelayAgent";
import { hashFailureMessage, useHostContent } from "./useHostContent";

/** The `mpOpenBattle` argument shape, minus the connection key the parent supplies. */
export type OpenBattleArgs = Omit<
  Parameters<typeof mpOpenBattle>[0],
  "serverKey"
>;

/** Spring's conventional lobby-host port; editable for power users / multi-host. */
export const DEFAULT_HOST_PORT = 8452;

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
 */
export function HostBattleForm({
  relayAvailable,
  onHost,
  initialMap,
  initialGame,
  initialTitle,
}: {
  /** Whether this lobby server has a relay to host through, from
   *  `relayHostingAvailable`. False everywhere today, and the bottom rung of the
   *  ladder does not exist without it. */
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
  const content = useHostContent(initialGame, initialMap);
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

  const [title, setTitle] = useState(initialTitle ?? "");
  // 8 is a sensible starting size for a fresh host (issue #502), the user can
  // still raise it. A "Host as battle" draft only ever carries the AIs (added
  // as bots, not real player slots) plus the one human host seat, so no
  // preset needs this raised to fit.
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [port, setPort] = useState(DEFAULT_HOST_PORT);
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
    if (!canHost || !target || hosting) return;
    setError(null);
    setLeftover(null);
    setHosting(true);
    // Dropped before the attempt rather than after it, so a host that fails
    // leaves no route behind for the next reader to believe.
    recordHostingRoute(null);
    try {
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
        version: target.engineVersion,
        map: mapName,
        title: title.trim() || `${gameName} — hosted`,
        modname: gameName,
      });
      // Only once the battle is actually open, so nothing downstream describes a
      // route for a battle that never happened. Read back by the battle room
      // (issue #2022).
      recordHostingRoute(route);
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

          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Map</span>
            <OptionSelect
              value={mapName}
              onValueChange={setMapName}
              options={maps.map((m) => ({ value: m.name, label: m.name }))}
              placeholder={content.scanning ? "Scanning…" : "Select a map"}
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

          <ReachablePorts
            ports={relayAlways ? null : battlePorts(port)}
            help={
              relayAlways
                ? "Not asked, because every battle you host goes through the server's relay."
                : `Coilbox asks your router to forward UDP ${port}, the port the engine hosts the game on, and hands it back if you close this without hosting.`
            }
            onReport={setReachability}
            always
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
              <span className="text-xs text-muted-foreground">
                {relayModeHelp(relayMode)}
              </span>
            </div>
          )}

          {/* What hosting is about to do, in the place where the answer it is
              reading appears. Not the same thing as issue #2022, which tells
              the people already in a battle why their ping is what it is. This
              is the host, before they commit to anything. */}
          <p className="text-xs text-muted-foreground">
            {hostingRouteSummary(route, {
              lanRoom: false,
              relayDeclined,
              relayAlways,
            })}
          </p>

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
              disabled={!canHost || hosting}
            >
              {hostButtonLabel()}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

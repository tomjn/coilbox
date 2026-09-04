import { Button, Input, useSetting } from "@picoframe/frame";
import { useState } from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  advertisedGamePort,
  HOST_THROUGH_RELAY_KEY,
  hostingRoute,
  hostingRouteSummary,
  NAT_TYPE_DIRECT,
  recordHostingRoute,
} from "../../direct/hostingRoute";
import { ReachablePorts } from "../../direct/ReachablePorts";
import {
  battlePorts,
  type DirectReachability,
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
 * "Host a battle" affordance for the Battles hub: a compact popover collecting the
 * game, map, title, size and (optional) password, then firing OPENBATTLE via the
 * parent's `onHost`. The engine is the preferred one (no picker), and the mod/map
 * hashes come from unitsync so joining clients can sync.
 *
 * How the battle is reachable is worked out rather than asked about. There used
 * to be a "Hole punching for NAT players" checkbox here, which advertised
 * `natType 1` and bought a battle that looked joinable and was not, because
 * coilbox has never implemented hole punching. It is gone, and what replaced it
 * is {@link hostingRoute} reading the answer {@link ReachablePorts} already had
 * (issue #2020).
 */
export function HostBattlePopover({
  disabled,
  relayAvailable,
  onHost,
  initialMap,
  initialGame,
  initialTitle,
  autoOpen,
}: {
  disabled: boolean;
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
  /** Open the popover on mount, paired with `initialMap`/`initialGame` for the same jump. */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!autoOpen);
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
  // Null until the host asks it to look, which is a route decision of its own.
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
  // Whether to fall through to the relay when the router has refused. Stored, so
  // somebody who cares about their ping says it once rather than every time they
  // host, and on by default because the hosts who reach that rung are the ones
  // least able to work out why hosting failed (issue #2023).
  const [wantsRelay, setWantsRelay] = useSetting<boolean>(
    HOST_THROUGH_RELAY_KEY,
    true,
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
  const route = hostingRoute(reachability, relayAvailable, wantsRelay);
  // Only when there was a relay to refuse. On a server with none the host's
  // answer changed nothing, and crediting them for an outcome that was never
  // theirs would send them to a checkbox that cannot fix it.
  const relayDeclined = relayAvailable && !wantsRelay;

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
      setOpen(false);
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
                ports={battlePorts(port)}
                help={`Asks your router to forward UDP ${port}, which is the port the engine hosts the game on. One port, because the lobby is somebody else's server and coilbox listens on nothing.`}
                onReport={setReachability}
              />

              {/* The bottom rung of the ladder, asked about next to the answer
                  that decides whether it is reached. This is the one place the
                  relay's cost is written down: the route sentence below says
                  which way the battle is going, not what that is worth, because
                  somebody choosing needs the price and somebody reading the
                  outcome has already paid it (issue #2023). */}
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={wantsRelay}
                  onCheckedChange={(checked) => setWantsRelay(checked === true)}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    Use the server's relay when nothing else works
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Only asked for once your own router has refused. A relay
                    costs the lobby server bandwidth and puts an extra hop
                    between you and every player, so pings are worse than a
                    direct game. Turn it off and a battle that would have been
                    relayed can only be joined by players who can already reach
                    this machine.
                    {!relayAvailable &&
                      " This server has no relay, so nothing is relayed here either way."}
                  </span>
                </span>
              </label>

              {/* What hosting is about to do, in the place where the answer it
                  is reading appears. Not the same thing as issue #2022, which
                  tells the people already in a battle why their ping is what it
                  is. This is the host, before they commit to anything. */}
              <p className="text-xs text-muted-foreground">
                {hostingRouteSummary(route, { lanRoom: false, relayDeclined })}
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

              <Button
                type="submit"
                className="h-8"
                disabled={!canHost || hosting}
              >
                {hostButtonLabel()}
              </Button>
            </>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

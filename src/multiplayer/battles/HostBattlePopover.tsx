import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { ReachablePorts } from "../../direct/ReachablePorts";
import { battlePorts } from "../../direct/reachability";
import type { mpOpenBattle } from "../bindings";
import { hostBattleFailure } from "./hostBattle";
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
 * hashes come from unitsync so joining clients can sync. The battle opens as a
 * plain natType 0 one that needs `port` reachable, which is the only mode
 * coilbox implements. "Hole punching" opts into advertising natType 1 instead,
 * for a host who knows their joiners bring their own traversal.
 *
 * Making `port` reachable used to be entirely the host's problem and this said
 * so. {@link ReachablePorts} now offers to ask their router, and says what to do
 * by hand when it refuses, which on most home routers it will.
 */
export function HostBattlePopover({
  disabled,
  onHost,
  initialMap,
  initialGame,
  initialTitle,
  autoOpen,
}: {
  disabled: boolean;
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
  // Default off. natType 1 tells joiners that the lobbies either side will open
  // a path through the routers between them, and nothing in coilbox does that
  // work, so all it bought was a battle that looked joinable and was not.
  // Direct is what we implement, so direct is what we advertise.
  const [holePunch, setHolePunch] = useState(false);
  // Why the last press did nothing. A refusal that never reaches the wire leaves
  // no join error and no disconnect, so this is the only account of it there is
  // (issue #1591).
  const [error, setError] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canHost || !target || hosting) return;
    setError(null);
    setHosting(true);
    try {
      await onHost({
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
    } catch (err) {
      // Left open on purpose: the answer is in here, and the fields that need
      // changing are too.
      setError(hostBattleFailure(err));
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
              />

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
                      ? `Tells joiners they need help getting through your router. Coilbox does not do that work, so port ${port} being open is still what makes joins succeed.`
                      : `Players connect straight to port ${port}. It has to be open on your router or others cannot join.`}
                  </span>
                </span>
              </label>

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

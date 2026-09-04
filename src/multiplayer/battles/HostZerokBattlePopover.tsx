import { Button, Input } from "@picoframe/frame";
import { memo, useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { OptionSelect } from "@/components/OptionSelect";
import type { mpZerokOpenBattle, ZerokBattleMode } from "../bindings";
import { hostBattleFailure } from "./hostBattle";
import {
  MAX_PLAYERS_RANGE,
  newZerokBattleProblem,
  seatedBy,
  ZEROK_BATTLE_MODES,
} from "./zerokBattle";

/** The `mpZerokOpenBattle` argument shape, minus the connection key the parent
 * supplies. */
export type ZerokOpenBattleArgs = Omit<
  Parameters<typeof mpZerokOpenBattle>[0],
  "serverKey"
>;

/** The map option that means "name none and let the server choose". Radix
 * refuses an empty value, and a NUL cannot appear in a name unitsync returned,
 * so this cannot be mistaken for a map. */
const SERVER_PICKS = "\u0000";

/**
 * "Host a battle" for the Battles hub on a Zero-K server, sitting where the
 * TASServer popover of the same name sits on a line-protocol one.
 *
 * The word host is the one Zero-K itself uses, but the machine running the game
 * is the server's, not this one. So the fields a TASServer host needs are all
 * absent: no port to forward, no NAT mode, no content hashes, and no engine or
 * game, both of which the server fills in from its own content. What is left is
 * the room itself. Founding it is what gives its commands to us rather than to a
 * vote.
 *
 * The map is offered as a request. The server resolves the name against what it
 * has and picks a recommended map when it cannot, so naming none is a real
 * choice rather than an empty field.
 */
export const HostZerokBattlePopover = memo(function HostZerokBattlePopover({
  disabled,
  onHost,
  initialMap,
  initialTitle,
  autoOpen,
}: {
  disabled: boolean;
  /** Rejects when the battle did not open, which is what this form shows. */
  onHost: (args: ZerokOpenBattleArgs) => Promise<void>;
  /** Preselect this map, as a content map detail's "Host a battle here" does. */
  initialMap?: string;
  /** Preselect this title, as a skirmish preset's name does. */
  initialTitle?: string;
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

  const [title, setTitle] = useState(initialTitle ?? "");
  const [mode, setMode] = useState<ZerokBattleMode>("custom");
  const [mapName, setMapName] = useState(initialMap ?? SERVER_PICKS);
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);

  const named = mapName !== SERVER_PICKS;
  // Held still across renders. The picker scrolls back to the selected option
  // whenever its list is rebuilt, and rebuilding it on every render meant a
  // battle changing in the list behind this form threw away where you had
  // scrolled to.
  const mapOptions = useMemo(
    () => [
      { value: SERVER_PICKS, label: "Let the server pick" },
      // A map we were sent to host but do not have is still a map the server
      // can run. Listed rather than left out, because a value with no option
      // behind it shows as an empty picker over a form that would go on to ask
      // for that map anyway.
      ...(named && !maps.some((m) => m.name === mapName)
        ? [{ value: mapName, label: `${mapName} (not installed)` }]
        : []),
      ...maps.map((m) => ({ value: m.name, label: m.name })),
    ],
    [maps, mapName, named],
  );
  const problem = newZerokBattleProblem({ title, mode, maxPlayers });
  const seated = seatedBy(mode, maxPlayers);
  const blurb = ZEROK_BATTLE_MODES.find((m) => m.value === mode)?.blurb;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || hosting) return;
    setError(null);
    setHosting(true);
    try {
      await onHost({
        title: title.trim(),
        map: named ? mapName : null,
        mode,
        maxPlayers,
        password: password.trim() || null,
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
          <p className="text-xs text-muted-foreground">
            The server runs the game, so there is nothing to forward and no
            address to give out. Founding the room is what lets you set the map
            and start the match without putting either to a vote.
          </p>

          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A name for the room"
            />
          </label>

          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Mode</span>
            <OptionSelect
              value={mode}
              onValueChange={(v) => setMode(v as ZerokBattleMode)}
              options={ZEROK_BATTLE_MODES}
              size="sm"
            />
          </label>
          {blurb && <p className="text-xs text-muted-foreground">{blurb}</p>}

          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Map</span>
            <OptionSelect
              value={mapName}
              onValueChange={setMapName}
              options={mapOptions}
              placeholder={scan.loading ? "Scanning…" : "Let the server pick"}
              size="sm"
            />
          </label>

          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Max players</span>
            <Input
              type="number"
              min={MAX_PLAYERS_RANGE.min}
              max={MAX_PLAYERS_RANGE.max}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value) || 0)}
            />
          </label>
          {seated !== maxPlayers && !problem && (
            <p className="text-xs text-muted-foreground">
              This mode seats {seated}, whatever the room asks for.
            </p>
          )}

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

          {problem && (
            <p className="text-xs text-muted-foreground">{problem}</p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="h-8" disabled={!!problem || hosting}>
            {hosting ? "Hosting…" : "Host battle"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
});

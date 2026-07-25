import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Side } from "@/content/bindings";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { cn } from "@/lib/utils";
import { aiByline } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { useMultiplayer } from "../store";
import { allyLetter, isAiUnavailable, type MemberRow as Row } from "./config";
import { type MemberControls, MemberRow } from "./MemberRow";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/**
 * The battle's player + bot list. Purpose-built for multiplayer (rather than
 * adapting play's `ParticipantsTable`): it adds Ready/Sync indicator columns and
 * a host/self/bot distinction, and only the logged-in user's row is editable —
 * `MemberRow` handles the read-only-vs-editable branching per cell.
 */
export function BattleMembersTable({
  rows,
  sides,
  factionLogos,
  maxSlots,
  startPosType,
  selfHost,
  canAddBot,
  hostControls,
  addableAis,
  addableAisReady,
  noteFor,
  onSetNote,
  statsSummaryFor,
  onAddBot,
  onSide,
  onTeam,
  onAlly,
  onColor,
}: {
  rows: Row[];
  sides: Side[];
  /** Resolved faction emblems, keyed by lowercased side name (may be empty). */
  factionLogos?: Record<string, FactionLogoSrc>;
  /** Upper bound for the team/ally pickers (typically the battle's maxPlayers). */
  maxSlots: number;
  /** The battle's start-position mode; with 0 (fixed map positions) the team
   * picker notes that team N spawns at the map's start position N. */
  startPosType?: number;
  /** When true, the viewer hosts this battle and may force/kick other members. */
  selfHost: boolean;
  /** When true, the viewer may add a bot (any seated member — see `useBattleRoom`). */
  canAddBot: boolean;
  hostControls: {
    forceTeam: (user: string, team: number) => void;
    forceAlly: (user: string, ally: number) => void;
    forceColor: (user: string, hex: string) => void;
    forceSpectator: (user: string) => void;
    kick: (user: string) => void;
    removeBot: (name: string) => void;
    updateBot: (
      name: string,
      patch: { teamId?: number; ally?: number },
    ) => void;
    changeBotAi: (name: string, aiShortName: string) => void;
  };
  /** AIs addable as bots — native engine AIs and the game's own Lua AIs. */
  addableAis: {
    shortName: string;
    kind: "native" | "lua";
    name?: string;
    version?: string;
    description?: string;
  }[];
  /** Whether `addableAis` has finished loading (#531). Gates the invalid-AI
   * flag below so a bot's AI never reads as unavailable before the list is
   * actually known. */
  addableAisReady: boolean;
  /** Current private note for a human row ("" for none). Bots have no account
   * so aren't offered notes (see `MemberRow`'s `onSetNote` gating below). */
  noteFor?: (row: Row) => string;
  onSetNote?: (row: Row, text: string) => void;
  /** "N games with this player…" summary from the local replay-stats database
   * (#375), shown in the note popover alongside the manual note. */
  statsSummaryFor?: (row: Row) => string | null;
  onAddBot: (aiShortName: string) => void;
  onSide: (side: number) => void;
  onTeam: (teamId: number) => void;
  onAlly: (ally: number) => void;
  onColor: (hex: string) => void;
}) {
  const { justWentIngame } = useMultiplayer();
  // The AI the host will add next; defaults to the first available.
  const [chosenAi, setChosenAi] = useState("");
  useEffect(() => {
    if (addableAis.length > 0)
      setChosenAi((c) =>
        addableAis.some((a) => a.shortName === c) ? c : addableAis[0].shortName,
      );
  }, [addableAis]);

  // Bots we added ourselves are ours to remove (REMOVEBOT accepts the owner as
  // well as the founder), which matters in an autohost battle where nobody here is
  // the founder. `self` marks our own row, so the roster already names us.
  const me = rows.find((r) => r.self)?.name;
  const ownsABot = rows.some((r) => r.kind === "bot" && r.owner === me);
  const showActions = selfHost || ownsABot;

  const slots = Math.max(2, Math.min(maxSlots || 0, 16));
  // First seated member per team, in row order: the "leader" whose colour marks
  // the team in the picker, and whom later members of the same team visually
  // hang off (branch glyph / Co-player badge). Display-only — wire state (each
  // member's own colour/side/ally) is untouched.
  const leaderByTeamId = new Map<number, Row>();
  for (const r of rows) {
    if (!r.spectator && !leaderByTeamId.has(r.teamId))
      leaderByTeamId.set(r.teamId, r);
  }
  // Group rows by team so shared teams sit together; spectators sink to the
  // bottom. Stable, so join order is kept within a team (leader stays first).
  const displayOrder = [...rows].sort(
    (a, b) =>
      (a.spectator ? Number.MAX_SAFE_INTEGER : a.teamId) -
      (b.spectator ? Number.MAX_SAFE_INTEGER : b.teamId),
  );
  const sideOptions = sides.map((s: Side, i) => {
    const logo = factionLogos?.[s.name.toLowerCase()];
    return {
      value: String(i),
      label: s.name,
      icon: logo ? (
        <FactionLogo logo={logo} sideName={s.name} size={16} />
      ) : undefined,
    };
  });
  // Offer only as many teams as there are seated members (like the skirmish
  // table) rather than every battle slot — but never drop a team number someone
  // already holds, so the select always has its current value.
  const seated = rows.filter((r) => !r.spectator);
  const teamSlots = Math.min(
    slots,
    Math.max(seated.length, ...seated.map((r) => r.teamId + 1), 1),
  );
  const teamOptions = range(teamSlots).map((i) => {
    const leader = leaderByTeamId.get(i);
    return {
      value: String(i),
      label: String(i + 1),
      // Under fixed start positions the team number *is* the spawn choice — say
      // so in the picker, since nothing else in the room links the two (#456).
      description:
        startPosType === 0 ? `Spawns at map position ${i + 1}` : undefined,
      // Taken teams show their leader's colour in the open dropdown; an unused
      // slot keeps a blank spacer so the numbers stay aligned.
      icon: (
        <span
          aria-hidden
          className={cn(
            "size-3 shrink-0 rounded-sm",
            leader && "border border-white/25",
          )}
          style={leader ? { background: leader.colorHex } : undefined}
        />
      ),
    };
  });
  const allyOptions = range(slots).map((i) => ({
    value: String(i),
    label: `Ally ${allyLetter(i)}`,
  }));
  // The AI options, shared by the Add AI dropdown and each bot row's in-place AI
  // picker (issue #532), so both offer exactly the game's addable AIs.
  const aiOptions = addableAis.map((a) => ({
    value: a.shortName,
    label: a.name ?? a.shortName,
    description: aiByline(a),
  }));

  return (
    <div className="rounded-lg border border-border/50 bg-card">
      {/* Cap at half the viewport so a crowded lobby scrolls instead of pushing
          the chat off-screen; the header stays pinned. */}
      <div className="max-h-[50vh] overflow-auto">
        <Table className="border-collapse">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground border-border/40 hover:bg-transparent">
              <TableHead className="px-3 pb-2 pt-3 text-center font-medium text-muted-foreground">
                Ready
              </TableHead>
              <TableHead className="w-full px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Player
              </TableHead>
              <TableHead className="px-2 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Faction
              </TableHead>
              <TableHead className="px-2 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Team
              </TableHead>
              <TableHead className="px-2 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Ally
              </TableHead>
              {showActions && (
                <TableHead className="px-2 pb-2 pt-3">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayOrder.map((row) => {
              // A seated row whose team is led by an earlier row: it shows the
              // branch glyph / Co-player badge instead of duplicated controls.
              const leader = row.spectator
                ? undefined
                : leaderByTeamId.get(row.teamId);
              const sharedWith = leader && leader !== row ? leader : undefined;
              // The host controls other members: humans get force/kick, bots get
              // team/ally edits (UPDATEBOT) plus removal — MemberRow keeps a bot's
              // colour read-only, so onForceColor/onForceSpectator stay no-ops. Our
              // own row stays the self-editable path. Outside a battle we host, we
              // still control the bots we added.
              let control: MemberControls | null = null;
              if (selfHost && row.kind === "human" && !row.self) {
                control = {
                  onForceTeam: (t) => hostControls.forceTeam(row.name, t),
                  onForceAlly: (a) => hostControls.forceAlly(row.name, a),
                  onForceColor: (c) => hostControls.forceColor(row.name, c),
                  onForceSpectator: () => hostControls.forceSpectator(row.name),
                  onKick: () => hostControls.kick(row.name),
                };
              } else if (row.kind === "bot" && (selfHost || row.owner === me)) {
                const noop = () => {};
                control = {
                  onForceTeam: (t) =>
                    hostControls.updateBot(row.name, { teamId: t }),
                  onForceAlly: (a) =>
                    hostControls.updateBot(row.name, { ally: a }),
                  onForceColor: noop,
                  onForceSpectator: noop,
                  onKick: () => hostControls.removeBot(row.name),
                  onChangeAi: (ai) => hostControls.changeBotAi(row.name, ai),
                };
              }
              // Defensive flag (#501): a bot whose AI isn't in this game's
              // addable list at all (a preset or hand-add from another game or
              // version) reads as invalid rather than as a normal bot.
              // `isAiUnavailable` compares by shortName only, so a valid AI
              // whose `aiDll` carries an id/version prefix (#547) isn't
              // flagged, and it never fires before the list has loaded.
              const aiInvalid =
                row.kind === "bot" &&
                isAiUnavailable(row.aiDll, addableAis, addableAisReady);
              return (
                <MemberRow
                  key={`${row.kind}:${row.name}`}
                  row={row}
                  editable={row.self}
                  aiInvalid={aiInvalid}
                  control={control}
                  sharedWith={sharedWith}
                  showActions={showActions}
                  flashIngame={justWentIngame.has(row.name)}
                  sideOptions={sideOptions}
                  teamOptions={teamOptions}
                  allyOptions={allyOptions}
                  aiOptions={aiOptions}
                  note={
                    row.kind === "human" && !row.self && noteFor
                      ? noteFor(row)
                      : undefined
                  }
                  onSetNote={
                    row.kind === "human" && !row.self && onSetNote
                      ? (text) => onSetNote(row, text)
                      : undefined
                  }
                  statsSummary={
                    row.kind === "human" && !row.self
                      ? statsSummaryFor?.(row)
                      : undefined
                  }
                  onSide={onSide}
                  onTeam={onTeam}
                  onAlly={onAlly}
                  onColor={onColor}
                />
              );
            })}
            {rows.length === 0 && (
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableCell
                  colSpan={showActions ? 6 : 5}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Waiting for players…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canAddBot && (
        <div className="flex items-center gap-2 border-t border-border/40 p-2">
          <span className="text-xs font-medium text-muted-foreground">
            Add AI
          </span>
          <OptionSelect
            value={chosenAi}
            onValueChange={setChosenAi}
            options={aiOptions}
            size="sm"
            className="w-auto min-w-40"
            placeholder={
              addableAis.length > 0 ? "Select an AI" : "No AIs installed"
            }
          />
          <Button
            className="h-8 px-3"
            disabled={!chosenAi}
            onClick={() => chosenAi && onAddBot(chosenAi)}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

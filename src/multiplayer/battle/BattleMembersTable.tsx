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
import { aiByline } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { useMultiplayer } from "../store";
import { allyLetter, type MemberRow as Row } from "./config";
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
  selfHost,
  canAddBot,
  hostControls,
  addableAis,
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
  };
  /** AIs addable as bots — native engine AIs and the game's own Lua AIs. */
  addableAis: {
    shortName: string;
    kind: "native" | "lua";
    name?: string;
    version?: string;
    description?: string;
  }[];
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
  const teamOptions = range(slots).map((i) => ({
    value: String(i),
    label: String(i + 1),
  }));
  const allyOptions = range(slots).map((i) => ({
    value: String(i),
    label: `Ally ${allyLetter(i)}`,
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
              <TableHead className="px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Faction
              </TableHead>
              <TableHead className="px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
                Team
              </TableHead>
              <TableHead className="px-3 pb-2 pt-3 text-left font-medium text-muted-foreground">
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
            {rows.map((row) => {
              // The host controls other members: humans get force/kick, bots get
              // removal only (MemberRow ignores the force handlers for bots). Our
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
                  onForceTeam: noop,
                  onForceAlly: noop,
                  onForceColor: noop,
                  onForceSpectator: noop,
                  onKick: () => hostControls.removeBot(row.name),
                };
              }
              return (
                <MemberRow
                  key={`${row.kind}:${row.name}`}
                  row={row}
                  editable={row.self}
                  control={control}
                  showActions={showActions}
                  flashIngame={justWentIngame.has(row.name)}
                  sideOptions={sideOptions}
                  teamOptions={teamOptions}
                  allyOptions={allyOptions}
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
            options={addableAis.map((a) => ({
              value: a.shortName,
              label: a.name ?? a.shortName,
              description: aiByline(a),
            }))}
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

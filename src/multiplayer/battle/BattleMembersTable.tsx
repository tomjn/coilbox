import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import type { Side } from "@/content/bindings";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
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
  maxSlots,
  selfHost,
  hostControls,
  nativeAis,
  onAddBot,
  onSide,
  onTeam,
  onAlly,
  onColor,
}: {
  rows: Row[];
  sides: Side[];
  /** Upper bound for the team/ally pickers (typically the battle's maxPlayers). */
  maxSlots: number;
  /** When true, the viewer hosts this battle and may force/kick other members. */
  selfHost: boolean;
  hostControls: {
    forceTeam: (user: string, team: number) => void;
    forceAlly: (user: string, ally: number) => void;
    forceColor: (user: string, hex: string) => void;
    forceSpectator: (user: string) => void;
    kick: (user: string) => void;
    removeBot: (name: string) => void;
  };
  /** Native AIs the host can add as bots. */
  nativeAis: { shortName: string; name?: string }[];
  onAddBot: (aiShortName: string) => void;
  onSide: (side: number) => void;
  onTeam: (teamId: number) => void;
  onAlly: (ally: number) => void;
  onColor: (hex: string) => void;
}) {
  // The native AI the host will add next; defaults to the first available.
  const [chosenAi, setChosenAi] = useState("");
  useEffect(() => {
    if (nativeAis.length > 0)
      setChosenAi((c) =>
        nativeAis.some((a) => a.shortName === c) ? c : nativeAis[0].shortName,
      );
  }, [nativeAis]);

  const slots = Math.max(2, Math.min(maxSlots || 0, 16));
  const sideOptions = sides.map((s: Side, i) => ({
    value: String(i),
    label: s.name,
  }));
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
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 pb-2 pt-3 text-center font-medium">Ready</th>
              <th className="w-full px-3 pb-2 pt-3 text-left font-medium">
                Player
              </th>
              <th className="px-3 pb-2 pt-3 text-left font-medium">Faction</th>
              <th className="px-3 pb-2 pt-3 text-left font-medium">Team</th>
              <th className="px-3 pb-2 pt-3 text-left font-medium">Ally</th>
              {selfHost && (
                <th className="px-2 pb-2 pt-3">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // The host controls other members: humans get force/kick, bots get
              // removal only (MemberRow ignores the force handlers for bots). Our
              // own row stays the self-editable path.
              let control: MemberControls | null = null;
              if (selfHost && row.kind === "human" && !row.self) {
                control = {
                  onForceTeam: (t) => hostControls.forceTeam(row.name, t),
                  onForceAlly: (a) => hostControls.forceAlly(row.name, a),
                  onForceColor: (c) => hostControls.forceColor(row.name, c),
                  onForceSpectator: () => hostControls.forceSpectator(row.name),
                  onKick: () => hostControls.kick(row.name),
                };
              } else if (selfHost && row.kind === "bot") {
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
                  showActions={selfHost}
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
              <tr className="border-t border-border/40">
                <td
                  colSpan={selfHost ? 6 : 5}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Waiting for players…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selfHost && (
        <div className="flex items-center gap-2 border-t border-border/40 p-2">
          <span className="text-xs font-medium text-muted-foreground">
            Add AI
          </span>
          <OptionSelect
            value={chosenAi}
            onValueChange={setChosenAi}
            options={nativeAis.map((a) => ({
              value: a.shortName,
              label: a.name ?? a.shortName,
            }))}
            size="sm"
            className="w-auto min-w-40"
            placeholder={
              nativeAis.length > 0 ? "Select an AI" : "No AIs installed"
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

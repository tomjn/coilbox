import type { Side } from "@/content/bindings";
import { allyLetter, type MemberRow as Row } from "./config";
import { MemberRow } from "./MemberRow";

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
  onSide,
  onTeam,
  onAlly,
  onColor,
}: {
  rows: Row[];
  sides: Side[];
  /** Upper bound for the team/ally pickers (typically the battle's maxPlayers). */
  maxSlots: number;
  onSide: (side: number) => void;
  onTeam: (teamId: number) => void;
  onAlly: (ally: number) => void;
  onColor: (hex: string) => void;
}) {
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MemberRow
                key={`${row.kind}:${row.name}`}
                row={row}
                editable={row.self}
                sideOptions={sideOptions}
                teamOptions={teamOptions}
                allyOptions={allyOptions}
                onSide={onSide}
                onTeam={onTeam}
                onAlly={onAlly}
                onColor={onColor}
              />
            ))}
            {rows.length === 0 && (
              <tr className="border-t border-border/40">
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Waiting for players…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

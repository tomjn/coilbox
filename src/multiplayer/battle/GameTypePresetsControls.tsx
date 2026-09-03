import { Button } from "@picoframe/frame";
import type { MemberRow } from "./config";
import {
  balanceLayout,
  currentAllyCount,
  type GameTypePreset,
  gameTypeLayout,
  type LayoutEntry,
  layoutToForceCommand,
} from "./gameTypePresets";

const PRESETS: { label: string; preset: GameTypePreset }[] = [
  { label: "Team", preset: "team" },
  { label: "FFA", preset: "ffa" },
  { label: "Coop", preset: "coop" },
  { label: "Duel", preset: "duel" },
  { label: "Tourney", preset: "tourney" },
];

/**
 * One-click game-type presets (Team/FFA/Coop/Duel/Tourney) plus a Balance
 * button, over the same seated non-spectator humans the roster already shows
 * (issue #344). Bots are left alone. A preset is about seating players, and
 * extending it to bots is deferred rather than built speculatively.
 *
 * Self-hosted: applies the layout directly (founder → own status push,
 * everyone else → `hostControls.forceAlly`/`forceTeam`, the same primitives
 * the per-row team/ally pickers already use). Autohost: one
 * `!force * (a,b)(c,d)` manual-balance line for presets, `!balance` for
 * Balance, both SPADS's own commands (~/dev/SPADS/var/help.dat, [force] and
 * [balance] sections). Offered to anyone the same as the rest of the
 * `!`-command panel: SPADS enforces the command's permission itself and
 * answers a denied attempt in chat.
 *
 * Hidden where the server assigns seats itself (Zero-K, Tachyon), since
 * there is nothing here to send on those protocols. This mirrors the
 * roster's own team/ally controls, which go read-only for the same reason.
 */
export function GameTypePresetsControls({
  rows,
  me,
  selfHost,
  serverAssignsSeat,
  hostControls,
  onSetBattleStatusBatch,
  onAutohostSend,
}: {
  rows: MemberRow[];
  me: string | null;
  selfHost: boolean;
  serverAssignsSeat: boolean;
  hostControls: {
    forceTeam: (user: string, team: number) => void;
    forceAlly: (user: string, ally: number) => void;
  };
  onSetBattleStatusBatch: (patch: { ally?: number; teamId?: number }) => void;
  onAutohostSend: (command: string) => void;
}) {
  if (serverAssignsSeat) return null;

  const active = rows.filter((r) => r.kind === "human" && !r.spectator);
  const activeNames = active.map((r) => r.name);

  function applyLayout(layout: LayoutEntry[]) {
    if (selfHost) {
      for (const entry of layout) {
        if (entry.name === me) {
          onSetBattleStatusBatch({ ally: entry.ally, teamId: entry.teamId });
        } else {
          hostControls.forceAlly(entry.name, entry.ally);
          hostControls.forceTeam(entry.name, entry.teamId);
        }
      }
      return;
    }
    const command = layoutToForceCommand(layout);
    if (command) onAutohostSend(command);
  }

  function onBalance() {
    if (selfHost) {
      applyLayout(
        balanceLayout(activeNames, currentAllyCount(active.map((r) => r.ally))),
      );
      return;
    }
    onAutohostSend("!balance");
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
      <span className="text-sm font-semibold">Team setup</span>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onBalance}>
          Balance
        </Button>
        {PRESETS.map((p) => (
          <Button
            key={p.preset}
            variant="outline"
            size="sm"
            onClick={() => applyLayout(gameTypeLayout(p.preset, activeNames))}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

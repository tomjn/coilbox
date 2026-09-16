import { Button } from "@picoframe/frame";
import { autohostHearsChat } from "../../direct/room";
import type { MemberRow } from "./config";
import {
  applyLayoutDirectly,
  balanceLayoutForRows,
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
 *
 * The Balance button reads "Suggest balance" for a joiner in a direct room:
 * self-hosted, it always acts directly and never touches chat, but a joiner
 * who is not self-hosting has no autohost to send `!balance` to, only the
 * room's founder reading the same chat everybody else does. It still sends
 * the same `!balance` line either way, and only the label differs.
 * `BattleChatCard` matches that line and offers the founder Accept/Reject on
 * it (issue #2871, replacing #2738's outright hiding of this button). The
 * other presets still send the same `!force` line unconditionally in a
 * direct room, which is an existing, separate gap this issue does not cover.
 */
export function GameTypePresetsControls({
  rows,
  me,
  selfHost,
  serverAssignsSeat,
  directRoom,
  hostControls,
  onSetBattleStatusBatch,
  onAutohostSend,
}: {
  rows: MemberRow[];
  me: string | null;
  selfHost: boolean;
  serverAssignsSeat: boolean;
  directRoom: boolean;
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
      applyLayoutDirectly(
        layout,
        me,
        hostControls.forceAlly,
        hostControls.forceTeam,
        onSetBattleStatusBatch,
      );
      return;
    }
    const command = layoutToForceCommand(layout);
    if (command) onAutohostSend(command);
  }

  function onBalance() {
    if (selfHost) {
      applyLayout(balanceLayoutForRows(rows));
      return;
    }
    onAutohostSend("!balance");
  }

  // Only the label says whether pressing this sends a real SPADS command or
  // a request the founder reads in the same chat (issue #2871): a direct
  // room has no autohost for a joiner's `!balance` to reach.
  const suggestOnly = !selfHost && !autohostHearsChat(directRoom);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
      <span className="text-sm font-semibold">Team setup</span>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onBalance}>
          {suggestOnly ? "Suggest balance" : "Balance"}
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

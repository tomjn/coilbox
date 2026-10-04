import { Bot } from "lucide-react";
import { useMemo } from "react";
import { GameIcon } from "@/components/GameIcon";
import { type AiRecordRow, aiRecordFor } from "../../aiRecord";
import type { StatRecord } from "../../bindings";
import { TallyBar } from "./StatWidgets";

function resultText(r: {
  wins: number;
  losses: number;
  undecided: number;
}): string {
  const parts = [`${r.wins}W`, `${r.losses}L`];
  if (r.undecided > 0) parts.push(`${r.undecided} undecided`);
  return parts.join(" · ");
}

/** One AI at one bonus in one game. */
function AiRow({ row }: { row: AiRecordRow }) {
  const decided = row.wins + row.losses;
  return (
    <li className="flex items-center gap-3 py-1.5">
      <GameIcon name={row.game} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm" title={row.ai}>
            {row.ai}
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {row.bonus ?? "No bonus"}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground" title={row.game}>
          {row.game}
        </p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {resultText(row)}
      </span>
      {decided > 0 ? (
        <TallyBar games={decided} wins={row.wins} />
      ) : (
        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
          no result
        </span>
      )}
    </li>
  );
}

/**
 * Your record against AI opponents, derived live from the same replay records
 * as the rest of the Player stats page (see `aiRecordFor` for what counts).
 * Rendered as a section there, so it inherits the page's distribution-profile
 * stats hiding (`multiplayer.stats`).
 */
export function AiRecordSection({
  records,
  playerName,
  refights,
  scripted,
}: {
  records: StatRecord[];
  playerName: string;
  refights: ReadonlySet<string>;
  /** Replays from campaign, Conquest and Warpath, which this section leaves out. */
  scripted: ReadonlySet<string>;
}) {
  const record = useMemo(
    () => aiRecordFor(records, playerName, refights, scripted),
    [records, playerName, refights, scripted],
  );

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Bot className="size-4 text-muted-foreground" />
        Against AI
        {record.games > 0 && (
          <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
            {record.games} game{record.games === 1 ? "" : "s"} ·{" "}
            {resultText(record)}
          </span>
        )}
      </h2>
      {record.games === 0 ? (
        <p className="text-sm text-muted-foreground">
          No skirmishes against AI yet. Games from campaign, Conquest and
          Warpath are not counted here.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/40">
            {record.rows.map((row) => (
              <AiRow key={row.key} row={row} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            A game against several different AIs shows on each one's row. Games
            from campaign, Conquest and Warpath are not counted.
          </p>
        </>
      )}
    </section>
  );
}

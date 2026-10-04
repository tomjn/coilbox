import { Button } from "@picoframe/frame";
import { Trophy } from "lucide-react";
import { Link } from "react-router";
import {
  BracketFrame,
  HUD_ACCENT_INK,
} from "../../../conquest/pages/components/hudChrome";
import type { RogueliteRun } from "../../model";
import { deepestColumn } from "../../progress";

export function RunEndScreen({
  run,
  onClear,
}: {
  run: RogueliteRun;
  onClear: () => void;
}) {
  const won = run.progress.status === "won";
  const depth = deepestColumn(run);
  const maxCol = Math.max(...run.nodes.map((n) => n.col), 1);
  const battlesWon = run.history.filter((h) => h.outcome === "victory").length;
  const stats: [string, string][] = [
    ["Depth reached", `${depth} / ${maxCol}`],
    ["Battles won", `${battlesWon}`],
    ["Units unlocked", `${run.progress.unlockedUnits.length}`],
    ["Perks earned", `${run.progress.perks.length}`],
    ["Hull remaining", `${run.progress.hull}`],
    ["Salvage banked", `${run.progress.salvage}`],
  ];
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <BracketFrame className="flex w-[30rem] max-w-full flex-col items-center gap-5 p-7 text-center">
        <Trophy
          className={`size-9 ${won ? "text-yellow-300" : "text-muted-foreground"}`}
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <h2
            className={`font-display text-2xl font-bold uppercase tracking-wide ${won ? "text-emerald-400" : HUD_ACCENT_INK.danger}`}
          >
            {won ? "Warpath complete" : "Warpath ended"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {won
              ? "The sector warlord is broken. The warpath is yours."
              : "Your ship gave out. The warpath is over."}
          </p>
        </div>
        <dl className="w-full divide-y divide-border/40 text-sm">
          {stats.map(([label, value]) => (
            <div key={label} className="flex justify-between py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <Link to="/warpath" className="w-full">
          <Button onClick={onClear} className="w-full">
            Back to warpath hub
          </Button>
        </Link>
      </BracketFrame>
    </div>
  );
}

import {
  AlertTriangle,
  Bot as BotIcon,
  CheckCircle2,
  Crown,
  Eye,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { allyLetter, type MemberRow as Row } from "./config";

/** Ready state as a round check/cross; spectators show an eye (always "ready"). */
function ReadyIcon({ row }: { row: Row }) {
  if (row.spectator) {
    return (
      <Eye className="size-4 text-muted-foreground" aria-label="Spectating" />
    );
  }
  return row.ready ? (
    <CheckCircle2 className="size-4 text-green-500" aria-label="Ready" />
  ) : (
    <XCircle className="size-4 text-destructive" aria-label="Not ready" />
  );
}

/**
 * One player/bot row. Only the logged-in user's own row is editable (faction,
 * team, ally, colour → MYBATTLESTATUS); every other row is read-only, so this
 * component branches on `editable` rather than a shared `disabled` flag.
 */
export function MemberRow({
  row,
  editable,
  sideOptions,
  teamOptions,
  allyOptions,
  onSide,
  onTeam,
  onAlly,
  onColor,
}: {
  row: Row;
  editable: boolean;
  sideOptions: { value: string; label: string }[];
  teamOptions: { value: string; label: string }[];
  allyOptions: { value: string; label: string }[];
  onSide: (side: number) => void;
  onTeam: (teamId: number) => void;
  onAlly: (ally: number) => void;
  onColor: (hex: string) => void;
}) {
  const subtitle = row.host
    ? "Host"
    : row.kind === "bot"
      ? `Bot · ${row.aiDll ?? "AI"}`
      : row.self
        ? "You"
        : "Player";

  return (
    <tr className="border-t border-border/40">
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-1.5">
          <ReadyIcon row={row} />
          {!row.spectator && row.sync === 2 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3.5" />
              Unsynced
            </span>
          )}
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          {editable ? (
            <input
              type="color"
              aria-label={`${row.name} colour`}
              value={row.colorHex}
              onChange={(e) => onColor(e.target.value)}
              className="color-swatch size-6 shrink-0 cursor-pointer rounded border border-white/25 bg-transparent p-0"
            />
          ) : (
            <span
              aria-hidden
              className="size-6 shrink-0 rounded border border-white/25"
              style={{ background: row.colorHex }}
            />
          )}
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1 truncate">
              {row.host && <Crown className="size-3.5 text-amber-500" />}
              {row.kind === "bot" && (
                <BotIcon className="size-3.5 text-muted-foreground" />
              )}
              <span className={cn("truncate", row.self && "font-medium")}>
                {row.name}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">{subtitle}</div>
          </div>
        </div>
      </td>

      <td className="px-3 py-2">
        {row.spectator ? (
          <span className="text-xs text-muted-foreground">–</span>
        ) : editable ? (
          <OptionSelect
            value={String(row.side)}
            size="sm"
            className="w-auto min-w-20"
            disabled={sideOptions.length === 0}
            options={sideOptions}
            onValueChange={(v) => onSide(Number(v))}
          />
        ) : (
          <span className="text-sm">
            {sideOptions.find((o) => o.value === String(row.side))?.label ??
              "–"}
          </span>
        )}
      </td>

      <td className="px-3 py-2">
        {row.spectator ? (
          <span className="text-xs text-muted-foreground">–</span>
        ) : editable ? (
          <OptionSelect
            value={String(row.teamId)}
            size="sm"
            className="w-20"
            options={teamOptions}
            onValueChange={(v) => onTeam(Number(v))}
          />
        ) : (
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded border border-border/60 bg-muted/40 px-2 text-xs">
            {row.teamId + 1}
          </span>
        )}
      </td>

      <td className="px-3 py-2">
        {row.spectator ? (
          <span className="text-xs text-muted-foreground">–</span>
        ) : editable ? (
          <OptionSelect
            value={String(row.ally)}
            size="sm"
            className="w-24"
            options={allyOptions}
            onValueChange={(v) => onAlly(Number(v))}
          />
        ) : (
          <span className="text-sm">Ally {allyLetter(row.ally)}</span>
        )}
      </td>
    </tr>
  );
}

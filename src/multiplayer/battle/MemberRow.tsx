import {
  AlertTriangle,
  Bot as BotIcon,
  CheckCircle2,
  Crown,
  Eye,
  UserX,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { allyLetter, type MemberRow as Row } from "./config";

/** Host-only actions over another member, bound to that member's name. */
export interface MemberControls {
  onForceTeam: (team: number) => void;
  onForceAlly: (ally: number) => void;
  onForceColor: (hex: string) => void;
  onForceSpectator: () => void;
  onKick: () => void;
}

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
 * One player/bot row. The logged-in user's own row is editable (faction, team,
 * ally, colour → MYBATTLESTATUS). In a battle WE host, `control` is also supplied
 * for OTHER members so the host can force their team/ally/colour, spectate or kick
 * them (there's no force-faction command, so side stays read-only for others).
 * Every remaining row is read-only.
 */
export function MemberRow({
  row,
  editable,
  control,
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
  control?: MemberControls | null;
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

  // Team/ally/colour are settable either by us on our own row (MYBATTLESTATUS) or
  // by the host on another HUMAN's row (FORCE*). Bots expose only removal (their
  // status would need UPDATEBOT), so they aren't status-editable here.
  const canEditStatus = editable || (!!control && row.kind === "human");
  const setTeam = (v: number) =>
    editable ? onTeam(v) : control?.onForceTeam(v);
  const setAlly = (v: number) =>
    editable ? onAlly(v) : control?.onForceAlly(v);
  const setColor = (hex: string) =>
    editable ? onColor(hex) : control?.onForceColor(hex);

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
          {canEditStatus ? (
            <input
              type="color"
              aria-label={`${row.name} colour`}
              value={row.colorHex}
              onChange={(e) => setColor(e.target.value)}
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {subtitle}
              </span>
              {control && (
                <span className="flex items-center gap-1.5">
                  {row.kind === "human" && !row.spectator && (
                    <button
                      type="button"
                      onClick={control.onForceSpectator}
                      title={`Move ${row.name} to spectators`}
                      className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Eye className="size-3" />
                      Spectate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={control.onKick}
                    title={
                      row.kind === "bot"
                        ? `Remove ${row.name}`
                        : `Kick ${row.name}`
                    }
                    className="inline-flex items-center gap-0.5 text-[11px] text-destructive/80 hover:text-destructive"
                  >
                    <UserX className="size-3" />
                    {row.kind === "bot" ? "Remove" : "Kick"}
                  </button>
                </span>
              )}
            </div>
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
        ) : canEditStatus ? (
          <OptionSelect
            value={String(row.teamId)}
            size="sm"
            className="w-20"
            options={teamOptions}
            onValueChange={(v) => setTeam(Number(v))}
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
        ) : canEditStatus ? (
          <OptionSelect
            value={String(row.ally)}
            size="sm"
            className="w-24"
            options={allyOptions}
            onValueChange={(v) => setAlly(Number(v))}
          />
        ) : (
          <span className="text-sm">Ally {allyLetter(row.ally)}</span>
        )}
      </td>
    </tr>
  );
}

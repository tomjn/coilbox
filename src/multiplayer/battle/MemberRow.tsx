import {
  AlertTriangle,
  Bot as BotIcon,
  CheckCircle2,
  Crown,
  Eye,
  MoreVertical,
  UserX,
  XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { NoteButton } from "../NoteButton";
import { CountryFlag, RankBadge } from "../UserBadges";
import { allyLetter, type MemberRow as Row } from "./config";

/** Actions over another member (host) or over a bot we own, bound to its name. */
export interface MemberControls {
  onForceTeam: (team: number) => void;
  onForceAlly: (ally: number) => void;
  onForceColor: (hex: string) => void;
  onForceSpectator: () => void;
  onKick: () => void;
  /** Bots we own/host only: change the bot's AI in place (issue #532). */
  onChangeAi?: (aiShortName: string) => void;
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
 * for OTHER members so the host can force their team/ally/colour (inline), and
 * spectate or kick them from a trailing `⋮` menu (there's no force-faction
 * command, so side stays read-only for others). Bots we own get `control` too, for
 * removal only. Every remaining row is read-only.
 *
 * `showActions` reserves the trailing actions column so every row lines up even
 * when a particular row has no menu (our own row, or a battle we neither host nor
 * have a bot in).
 */
export function MemberRow({
  row,
  editable,
  aiInvalid,
  control,
  sharedWith,
  showActions,
  flashIngame,
  sideOptions,
  teamOptions,
  allyOptions,
  aiOptions,
  note,
  onSetNote,
  statsSummary,
  onSide,
  onTeam,
  onAlly,
  onColor,
}: {
  row: Row;
  editable: boolean;
  /** Bots only: this bot's AI isn't in the game's addable list (#501). Flagged
   * inline so an invalid config from a cross-game/version preset reads as such. */
  aiInvalid?: boolean;
  control?: MemberControls | null;
  /** The earlier row leading this row's team, when the team is shared. The row
   * then shows a branch glyph and Co-player badge instead of colour/side/ally —
   * display-only; the member's own wire state is untouched and the team picker
   * stays live so they can leave. */
  sharedWith?: Row;
  showActions: boolean;
  /** Briefly highlight this row because the player just launched the game. */
  flashIngame?: boolean;
  sideOptions: { value: string; label: string; icon?: ReactNode }[];
  teamOptions: {
    value: string;
    label: string;
    description?: string;
    /** Dropdown-only leading glyph (a team colour swatch). */
    icon?: ReactNode;
  }[];
  allyOptions: { value: string; label: string }[];
  /** The game's addable AIs, for a bot row's in-place AI picker (issue #532). */
  aiOptions?: { value: string; label: string; description?: string }[];
  /** Current private note on this player ("" for none), and its setter. Humans
   * only, and never on our own row — see `notes.ts` (issue #341). */
  note?: string;
  onSetNote?: (text: string) => void;
  /** "N games with this player…" summary from the local replay-stats database
   * (#375), shown in the note popover alongside the manual note. */
  statsSummary?: string | null;
  onSide: (side: number) => void;
  onTeam: (teamId: number) => void;
  onAlly: (ally: number) => void;
  onColor: (hex: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canSpectate = row.kind === "human" && !row.spectator;
  const subtitle = row.host
    ? "Host"
    : row.kind === "bot"
      ? `Bot · ${row.aiDll ?? "AI"}`
      : row.self
        ? "You"
        : "Player";

  // Colour is settable by us on our own row (MYBATTLESTATUS) or by the host on
  // another HUMAN's row (FORCETEAMCOLOR). Bots keep a read-only swatch: a bot
  // colour input would be a second colour-picker drag surface (flood risk), and
  // colour isn't what the host needs to change on a bot.
  const canEditColor = editable || (!!control && row.kind === "human");
  // Team/ally are settable on any controlled row — humans via FORCE*, bots via
  // UPDATEBOT (both routed through `control`); discrete dropdowns, no flood risk.
  const canEditTeamAlly = editable || !!control;
  // A bot we own/host can have its AI changed in place (issue #532), offered
  // from the same list as the Add AI dropdown. Complements the invalid-AI flag
  // (#501): the host can now fix a bot carrying an AI this game doesn't offer.
  const canChangeAi =
    row.kind === "bot" &&
    !!control?.onChangeAi &&
    !!aiOptions &&
    aiOptions.length > 0;
  const setTeam = (v: number) =>
    editable ? onTeam(v) : control?.onForceTeam(v);
  const setAlly = (v: number) =>
    editable ? onAlly(v) : control?.onForceAlly(v);
  const setColor = (hex: string) =>
    editable ? onColor(hex) : control?.onForceColor(hex);
  const sharedTitle = sharedWith
    ? `Shares a team with ${sharedWith.name} — team settings come from the first member`
    : undefined;

  return (
    <TableRow
      className={cn(
        "border-border/40 hover:bg-transparent",
        flashIngame && "ingame-flash",
      )}
    >
      <TableCell className="px-3 py-2">
        <div className="flex items-center justify-center gap-1.5">
          <ReadyIcon row={row} />
          {!row.spectator && row.sync === 2 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3.5" />
              Unsynced
            </span>
          )}
        </div>
      </TableCell>

      <TableCell className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          {sharedWith ? (
            // A file-explorer-style branch in the team (leader's) colour,
            // marking this row as a member of the team led above it.
            <span
              aria-hidden
              title={sharedTitle}
              className="flex size-6 shrink-0 items-start justify-center"
            >
              <span
                className="h-4 w-3 translate-x-1.5 rounded-bl-md border-b-2 border-l-2"
                style={{ borderColor: sharedWith.colorHex }}
              />
            </span>
          ) : canEditColor ? (
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
              {row.country && <CountryFlag country={row.country} />}
              <span
                className={cn("truncate", row.self && "font-medium")}
                title={note || undefined}
              >
                {row.name}
              </span>
              {row.rank != null && <RankBadge rank={row.rank} />}
            </div>
            {aiInvalid && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3 shrink-0" />
                {row.aiDll} isn't available in this game
              </span>
            )}
            {canChangeAi ? (
              <OptionSelect
                value={
                  aiOptions?.some((o) => o.value === row.aiDll)
                    ? (row.aiDll ?? "")
                    : ""
                }
                onValueChange={(v) => control?.onChangeAi?.(v)}
                options={aiOptions ?? []}
                size="sm"
                className="mt-1 h-7 w-auto min-w-36"
                placeholder={row.aiDll ?? "Select an AI"}
              />
            ) : (
              !aiInvalid && (
                <span className="text-[11px] text-muted-foreground">
                  {subtitle}
                </span>
              )
            )}
          </div>
          {onSetNote && (
            <NoteButton
              name={row.name}
              note={note ?? ""}
              onSave={onSetNote}
              statsSummary={statsSummary}
            />
          )}
        </div>
      </TableCell>

      <TableCell className="px-2 py-2">
        {row.spectator ? (
          <span className="text-xs text-muted-foreground">–</span>
        ) : sharedWith ? (
          <Badge
            variant="outline"
            title={sharedTitle}
            style={{
              color: sharedWith.colorHex,
              borderColor: sharedWith.colorHex,
            }}
          >
            Co-player
          </Badge>
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
          (() => {
            const opt = sideOptions.find((o) => o.value === String(row.side));
            return (
              <span className="flex items-center gap-1.5 text-sm">
                {opt?.icon}
                {opt?.label ?? "–"}
              </span>
            );
          })()
        )}
      </TableCell>

      <TableCell className="px-2 py-2">
        {row.spectator ? (
          <span className="text-xs text-muted-foreground">–</span>
        ) : canEditTeamAlly ? (
          <Select
            value={String(row.teamId)}
            onValueChange={(v) => setTeam(Number(v))}
          >
            <SelectTrigger size="sm" className="w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teamOptions.map((o) => (
                <SelectItem
                  key={o.value}
                  value={o.value}
                  description={o.description}
                  icon={o.icon}
                >
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded border border-border/60 bg-muted/40 px-2 text-xs">
            {row.teamId + 1}
          </span>
        )}
      </TableCell>

      <TableCell className="px-2 py-2">
        {row.spectator ? (
          <span className="text-xs text-muted-foreground">–</span>
        ) : sharedWith ? null : canEditTeamAlly ? (
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
      </TableCell>

      {showActions && (
        <TableCell className="px-2 py-2 text-right">
          {control && (
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${row.name}`}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <MoreVertical className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                {canSpectate && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      control.onForceSpectator();
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Eye className="size-4" />
                    Force spectate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    control.onKick();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                >
                  <UserX className="size-4" />
                  {row.kind === "bot" ? "Remove" : "Kick"}
                </button>
              </PopoverContent>
            </Popover>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

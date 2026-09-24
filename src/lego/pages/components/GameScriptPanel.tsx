/**
 * The animation a unit opened out of a game comes with.
 *
 * The game's script is always taken when there is one. The only decision is
 * for a compiled `.cob` whose game also ships the `.bos` it was compiled from:
 * run the compiled file, which is exactly what the game plays, or convert the
 * source to Lua, which can be edited and is written by the export. Both are
 * laid out as named options rather than a switch, because "off" on a switch
 * reads as "no animation", which neither of them is.
 *
 * Roles the script named or showed are offered below it, grouped by how much
 * they are worth. A script returning a piece from `QueryNanoPiece` is naming
 * that piece's job. A piece that turned when the unit was told to aim is an
 * inference from behaviour, and somebody deciding whether to take it deserves
 * to know which they are looking at.
 *
 * Nothing here is applied. It reports and collects choices, and the drawer that
 * owns it does the applying when the unit is accepted.
 */

import { FileCode, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AdoptedScript } from "../../adoptGameScript";
import { roleLabel } from "../../animPresets";
import type { RoleProposal } from "../../inferRoles";

interface Props {
  /** What was found, or null while it is still being read. */
  adopted: AdoptedScript | null;
  /** Whether the unit takes the Lua on offer. Always true for a game's own
   *  Lua. For a compiled script it picks the conversion over the `.cob`. */
  takeScript: boolean;
  onTakeScript: (on: boolean) => void;
  /** Piece names whose proposed role will be applied. */
  taken: Set<string>;
  onToggleRole: (pieceName: string) => void;
}

/** Each group of proposals gets a short heading, said once above the group
 *  rather than repeated on every row. */
const EVIDENCE: Record<RoleProposal["evidence"], string> = {
  stated: "Named by the script",
  observed: "Worked out from what moved",
};

export function GameScriptPanel({
  adopted,
  takeScript,
  onTakeScript,
  taken,
  onToggleRole,
}: Props) {
  // Nothing found and nothing to say is a unit not out of a game at all, and
  // there is no section to draw for it.
  if (adopted && !adopted.member && adopted.notes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Animation</h3>
      {adopted ? (
        <Found
          adopted={adopted}
          takeScript={takeScript}
          onTakeScript={onTakeScript}
          taken={taken}
          onToggleRole={onToggleRole}
        />
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Looking for this unit's animation script.
        </p>
      )}
    </section>
  );
}

function Found({
  adopted,
  takeScript,
  onTakeScript,
  taken,
  onToggleRole,
}: Props & { adopted: AdoptedScript }) {
  const proposals = adopted.findings?.proposals ?? [];
  const groups = (["stated", "observed"] as const)
    .map((evidence) => ({
      evidence,
      rows: proposals.filter((p) => p.evidence === evidence),
    }))
    .filter((group) => group.rows.length > 0);
  const { member, kind, converted } = adopted;

  return (
    <>
      {!member ? (
        <p className="text-xs text-muted-foreground">
          No script found, so the unit opens with the animation presets.
        </p>
      ) : kind === "lua" ? (
        <ScriptFile
          member={member}
          badge="Lua"
          detail="Imported as it is. Editable, and written by the export."
        />
      ) : converted && adopted.script ? (
        <ToggleGroup
          type="single"
          value={takeScript ? "lua" : "compiled"}
          onValueChange={(value) => value && onTakeScript(value === "lua")}
          className="flex w-full flex-col gap-2"
          aria-label="How to import the animation"
        >
          <Option
            value="compiled"
            title="Run the compiled script"
            member={member}
            detail="Plays exactly as in the game. Read only, and not written by the export."
          />
          <Option
            value="lua"
            title="Convert to Lua"
            member={converted.member}
            detail={
              adopted.notes.length > 0
                ? "Editable, and written by the export. Anything the conversion could not carry over is listed below."
                : "Editable, and written by the export."
            }
          />
        </ToggleGroup>
      ) : (
        <ScriptFile
          member={member}
          badge="Compiled"
          detail={
            adopted.compiled
              ? "Plays exactly as in the game. Read only, and not written by the export. The game ships no .bos source for it, so it cannot be converted to Lua."
              : "The file could not be read, so the unit opens with the animation presets."
          }
        />
      )}

      {groups.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">Piece roles</p>
          {groups.map(({ evidence, rows }) => (
            <div key={evidence} className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                {EVIDENCE[evidence]}
              </p>
              {rows.map((row) => (
                <div key={row.pieceName} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${row.pieceName}`}
                    checked={taken.has(row.pieceName)}
                    onCheckedChange={() => onToggleRole(row.pieceName)}
                  />
                  <Label
                    htmlFor={`role-${row.pieceName}`}
                    className="text-xs font-normal"
                  >
                    {row.pieceName} is {roleLabel(row.role).toLowerCase()}
                  </Label>
                  <code className="ml-auto text-[0.6875rem] text-muted-foreground">
                    {row.callin}
                  </code>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {adopted.notes.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
          {adopted.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The one script a unit comes with, when there is no choice to make. */
function ScriptFile({
  member,
  badge,
  detail,
}: {
  member: string;
  badge: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
      <FileCode
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <code className="truncate text-xs">{member}</code>
          <Badge variant="secondary" className="shrink-0">
            {badge}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/** One of the two ways a compiled script can come in. */
function Option({
  value,
  title,
  member,
  detail,
}: {
  value: string;
  title: string;
  member: string;
  detail: string;
}) {
  return (
    <ToggleGroupItem
      value={value}
      className="h-auto w-full flex-col items-start gap-1 whitespace-normal rounded-md border border-border/60 p-3 text-left data-[state=on]:border-primary data-[state=on]:bg-primary/10"
    >
      <span className="text-sm font-medium">{title}</span>
      <code className="break-all text-xs text-muted-foreground">{member}</code>
      <span className="text-xs font-normal text-muted-foreground">
        {detail}
      </span>
    </ToggleGroupItem>
  );
}

/** Which proposals a panel starts with taken, which is all of them. They are
 *  all shown before the unit is accepted, so none of this is silent. */
export function defaultTakenRoles(adopted: AdoptedScript): Set<string> {
  return new Set(
    (adopted.findings?.proposals ?? []).map((proposal) => proposal.pieceName),
  );
}

/**
 * Whether the unit starts on the Lua on offer.
 *
 * On for a game's own Lua, which is exactly the file the game runs, and which
 * is always taken. Off for a conversion, so a compiled unit starts on the file
 * the game actually plays and the conversion is the option somebody picks.
 */
export function defaultTakeScript(adopted: AdoptedScript): boolean {
  return adopted.kind === "lua" && adopted.script !== null;
}

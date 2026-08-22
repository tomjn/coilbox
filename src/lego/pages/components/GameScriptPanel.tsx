/**
 * What a game's own animation script said about the unit being opened.
 *
 * Shown between reading the model and accepting it, because both things it
 * offers are decisions: whether the unit keeps the game's script rather than
 * coilbox's presets, and which pieces take the roles the script named.
 *
 * The two kinds of proposal are grouped rather than mixed. A script returning a
 * piece from `QueryNanoPiece` is naming that piece's job. A piece that turned
 * when the unit was told to aim is an inference from behaviour, right nearly
 * always and still an inference, and somebody deciding whether to take it
 * deserves to know which they are looking at.
 *
 * Nothing here is applied. It reports and collects choices, and the drawer that
 * owns it does the applying when the unit is accepted.
 */

import { Button } from "@picoframe/frame";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AdoptedScript } from "../../adoptGameScript";
import { roleLabel } from "../../animPresets";
import type { RoleProposal } from "../../inferRoles";

interface Props {
  adopted: AdoptedScript;
  /** Whether the unit keeps the game's script rather than the presets. */
  takeScript: boolean;
  onTakeScript: (on: boolean) => void;
  /** Piece names whose proposed role will be applied. */
  taken: Set<string>;
  onToggleRole: (pieceName: string) => void;
}

/** How much a group of proposals is worth, said once above the group rather
 *  than repeated on every row. */
const EVIDENCE: Record<
  RoleProposal["evidence"],
  { heading: string; blurb: string }
> = {
  stated: {
    heading: "The script named these",
    blurb:
      "It hands these pieces back when the engine asks, so this is the script's own answer rather than a guess about it.",
  },
  observed: {
    heading: "These moved when the unit was asked to work",
    blurb:
      "Worked out from what moved and which way, which is right on nearly every unit and is still a reading rather than something the script says outright.",
  },
};

export function GameScriptPanel({
  adopted,
  takeScript,
  onTakeScript,
  taken,
  onToggleRole,
}: Props) {
  const proposals = adopted.findings?.proposals ?? [];
  const groups = (["stated", "observed"] as const)
    .map((evidence) => ({
      evidence,
      rows: proposals.filter((p) => p.evidence === evidence),
    }))
    .filter((group) => group.rows.length > 0);

  // Nothing found and nothing to say happens for a unit not out of a game at
  // all, and there is no panel to draw for it.
  if (!adopted.member && adopted.notes.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
      <p className="text-sm font-medium">This unit's animation</p>

      {adopted.kind === "lua" && adopted.member ? (
        <>
          <p className="text-xs text-muted-foreground">
            The game animates this unit with{" "}
            <code className="break-all">{adopted.member}</code>. Taken on, the
            unit keeps that script and an export writes it back. The animation
            presets do not apply to a unit that has its own script, and the
            script drawer can hand it back later.
          </p>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="take-game-script" className="text-xs font-medium">
              Keep the game's script
            </Label>
            <Switch
              id="take-game-script"
              checked={takeScript}
              onCheckedChange={onTakeScript}
            />
          </div>
        </>
      ) : null}

      {adopted.kind === "cob" && adopted.member ? (
        <>
          {adopted.converted ? (
            <>
              <p className="text-xs text-muted-foreground">
                The game animates this unit with{" "}
                <code className="break-all">{adopted.member}</code>, which is
                compiled rather than Lua. It ships the source that was compiled,{" "}
                <code className="break-all">{adopted.converted.member}</code>,
                and what is on offer here is that source converted to Lua.
              </p>
              <p className="text-xs text-muted-foreground">
                The converter is a set of text substitutions rather than a
                compiler, so this is not the game's own file and it needs
                checking. Read it in the script drawer and expect to fix parts
                of it by hand.
              </p>
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="take-game-script"
                  className="text-xs font-medium"
                >
                  Use the converted script
                </Label>
                <Switch
                  id="take-game-script"
                  checked={takeScript}
                  onCheckedChange={onTakeScript}
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              The game animates this unit with{" "}
              <code className="break-all">{adopted.member}</code>, which is
              compiled rather than Lua, and it does not ship the source that was
              compiled. Coilbox writes Lua, so this one is read and left alone,
              and the unit opens on the presets instead.
            </p>
          )}
          {adopted.listing ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline" className="w-full">
                  Read it anyway
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-2 text-xs text-muted-foreground">
                  Disassembled for reading. Not something that can be edited
                  here or written back, and the file itself is untouched.
                </p>
                <pre className="mt-2 max-h-64 overflow-auto rounded border border-border/60 bg-muted/40 p-2 text-[11px] leading-relaxed">
                  {adopted.listing}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      ) : null}

      {groups.map(({ evidence, rows }) => (
        <div key={evidence} className="flex flex-col gap-2">
          <p className="text-xs font-medium">{EVIDENCE[evidence].heading}</p>
          <p className="text-xs text-muted-foreground">
            {EVIDENCE[evidence].blurb}
          </p>
          {rows.map((row) => (
            <div key={row.pieceName} className="flex items-start gap-2">
              <Checkbox
                id={`role-${row.pieceName}`}
                checked={taken.has(row.pieceName)}
                onCheckedChange={() => onToggleRole(row.pieceName)}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <Label
                  htmlFor={`role-${row.pieceName}`}
                  className="text-xs font-medium"
                >
                  {row.pieceName} is {roleLabel(row.role).toLowerCase()}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  From <code>{row.callin}</code>.
                </p>
              </div>
            </div>
          ))}
        </div>
      ))}

      {adopted.notes.length > 0 ? (
        <div className="flex flex-col gap-1">
          {adopted.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
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
 * Whether the script switch starts on.
 *
 * On for a game's own Lua, which is exactly the file the game runs. Off for a
 * conversion, because that one is a set of text substitutions over BOS source
 * and accepting the unit is one click away. Somebody who reads the panel and
 * wants it turns it on, which is the offer the conversion is meant to be.
 */
export function defaultTakeScript(adopted: AdoptedScript): boolean {
  return adopted.kind === "lua" && adopted.script !== null;
}

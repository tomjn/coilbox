/**
 * The unit script: the one the animations generate, the one the user owns, or
 * the compiled file a game shipped. The one place a unit's script is read and
 * edited, whichever of the three it is.
 *
 * A unit starts with a generated script, shown here to read and copy. Taking
 * ownership hands it over: from then on this is an editor, the text is stored
 * on the unit, and an export writes exactly what is in it. Giving it back
 * discards that text and puts the presets back in charge, which undo reverses.
 *
 * Editing commits to the document on blur and when this tab is left or the
 * strip closes, which is what unmounting this component means: the strip
 * swaps whichever tab is showing for another, in the same way the parts and
 * compounds pickers already do. It follows the document on undo.
 *
 * Every piece name a Lua script uses is checked against the unit, a Lua
 * script's own call-in definitions are checked against the engine's real
 * names, and a run's own error is marked against the line it names, all as
 * gutter marks with a Checks count above them. After a run, the lines or COB
 * instruction offsets it never reached are shown at reduced opacity, so a
 * glance at the editor says what a preview actually exercised.
 */

import { Button, Drawer } from "@picoframe/frame";
import { Check, Copy, FileCode2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LintDiagnostic } from "@/animation/bindings";
import { animCobDisasmBytes } from "@/animation/bindings";
import {
  CheckItem,
  CheckSection,
  SEVERITY_COLOR,
  worstSeverity,
} from "@/components/CheckItem";
import { SourceEditor } from "@/components/SourceEditor";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorText } from "@/lib/helpers";
import { lintLuaCallins } from "../../luaCallinLint";
import { lineNamingPiece, missingPieces } from "../../luaPieces";
import { buildLuaScript, unitScript } from "../../luaScript";
import type { LegoProject } from "../../model";
import type { ScriptTimeline } from "../../scriptPlayback";

/** The line a run's error names, when it is about the main script rather than
 *  an `include`d file or nowhere in particular. The runtime's own error text
 *  is Lua's `chunkname:line: message`, and the main script's chunk name is
 *  exactly `${unitName}.lua`, which is what `lego_run_script` names it. */
function mainScriptErrorLine(error: string, unitName: string): number | null {
  const prefix = `${unitName}.lua:`;
  if (!error.startsWith(prefix)) return null;
  const match = /^(\d+):/.exec(error.slice(prefix.length));
  return match ? Number(match[1]) : null;
}

/** Whether a line holds code worth dimming when it did not run. A blank or
 *  comment-only line is left alone, so dimming reads as "this branch did not
 *  run" rather than a wall of grey down the margin. */
function isCodeLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("--");
}

interface Props {
  project: LegoProject;
  /** Stores the unit's own Lua. The first call is the unit taking it over. */
  onScriptChange: (script: string) => void;
  /** Drops the stored Lua, so the unit goes back to a script generated from
   *  its animation presets. */
  onScriptRelease: () => void;
  /**
   * The most recent run the Animation panel produced, whatever it managed,
   * for the error and coverage marks. Null once the script has changed since,
   * because the panel stops playback on that same change.
   */
  lastRun: ScriptTimeline | null;
}

export function ScriptTab({
  project,
  onScriptChange,
  onScriptRelease,
  lastRun,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const owned = project.script !== undefined;
  const compiled = owned ? undefined : project.compiledScript;
  const [draft, setDraft] = useState(project.script ?? "");

  // Follow the document when it changes underneath, which is what taking
  // ownership and an undo both look like from here.
  useEffect(() => setDraft(project.script ?? ""), [project.script]);

  // Only a script this unit owns is ever written back: `draft` starts as ""
  // for a generated or compiled script, which is not the same as never having
  // been edited, and committing it would take ownership with an empty script
  // nobody asked for.
  function commit() {
    if (owned && draft !== project.script) onScriptChange(draft);
  }

  // Committed on blur too, but a tab switch or the strip closing unmounts
  // this component without one, and the edit would otherwise be lost. Read
  // through a ref, since an unmount-only effect must not close over the
  // render it was created on.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);

  const shownLua = owned ? draft : compiled ? null : unitScript(project);

  // The compiled runtime's disassembly, read once per script: bytes in,
  // listing and per-line offsets out.
  const [disasm, setDisasm] = useState<{
    text: string;
    lineOffsets: (number | null)[];
  } | null>(null);
  const [disasmError, setDisasmError] = useState<string | null>(null);
  useEffect(() => {
    if (!compiled) {
      setDisasm(null);
      setDisasmError(null);
      return;
    }
    let active = true;
    animCobDisasmBytes({ bytes: compiled.bytes })
      .then((result) => {
        if (!active) return;
        setDisasm({ text: result.listing, lineOffsets: result.lineOffsets });
        setDisasmError(null);
      })
      .catch((error: unknown) => {
        if (active) setDisasmError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [compiled]);

  const shown = shownLua ?? disasm?.text ?? "";
  const lines = useMemo(() => shown.split("\n"), [shown]);

  // Both spellings of every piece, because a script may legitimately name
  // either. The engine takes a model's piece names exactly as the file writes
  // them, so a game's own script names `Trunk`, while coilbox lowercases them
  // and the generated script names `trunk`. An imported unit keeps the file's
  // spelling on `originalName`, and a unit opened out of a game is usually
  // carrying that game's script rather than a generated one.
  const diagnostics = useMemo(() => {
    const found: LintDiagnostic[] = [];
    if (shownLua !== null) {
      const pieceNames = project.pieces.flatMap((piece) =>
        piece.originalName ? [piece.name, piece.originalName] : [piece.name],
      );
      for (const name of missingPieces(shownLua, pieceNames)) {
        found.push({
          rule: "missing-piece",
          severity: "error",
          line: lineNamingPiece(shownLua, name),
          message: `This unit has no piece called "${name}". The engine fails to load a script that names a piece the model does not have.`,
        });
      }
      for (const problem of lintLuaCallins(shownLua)) {
        found.push({ rule: "callin-name", ...problem });
      }
    }
    // A run's own error, only when it is about a line of the main script
    // rather than an `include`d file or nowhere in particular, and only while
    // it still describes the text on screen.
    if (owned && lastRun?.error && draft === project.script) {
      const line = mainScriptErrorLine(lastRun.error, project.unitName);
      if (line !== null) {
        found.push({
          rule: "run-error",
          severity: "error",
          line,
          message: lastRun.error,
        });
      }
    }
    return found;
  }, [
    shownLua,
    project.pieces,
    project.unitName,
    project.script,
    owned,
    lastRun,
    draft,
  ]);

  // 0-indexed line -> its diagnostics, for the gutter's marks and tints.
  const lineProblems = useMemo(() => {
    const map = new Map<number, LintDiagnostic[]>();
    for (const d of diagnostics) {
      const list = map.get(d.line - 1);
      if (list) list.push(d);
      else map.set(d.line - 1, [d]);
    }
    return map;
  }, [diagnostics]);

  // Coverage only means something while it describes what is on screen: a
  // compiled script never changes underneath itself, but an owned one does
  // the moment a draft edit is not yet what was last run.
  const coverageReady =
    lastRun !== null && (!owned || draft === project.script);

  const dimmedLines = useMemo(() => {
    if (!coverageReady || !lastRun) return undefined;
    if (owned) {
      const ran = new Set(lastRun.linesRun);
      const dimmed = new Set<number>();
      lines.forEach((line, index) => {
        if (isCodeLine(line) && !ran.has(index + 1)) dimmed.add(index);
      });
      return dimmed;
    }
    if (compiled && disasm) {
      const ran = new Set(lastRun.offsetsRun);
      const dimmed = new Set<number>();
      disasm.lineOffsets.forEach((offset, index) => {
        if (offset !== null && !ran.has(offset)) dimmed.add(index);
      });
      return dimmed;
    }
    return undefined;
  }, [coverageReady, lastRun, owned, lines, compiled, disasm]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be unavailable. The text is selectable either way.
    }
  }

  const severity = worstSeverity(diagnostics.map((d) => d.severity));
  const unsaved = owned && draft !== project.script;
  const empty = owned && shown.trim() === "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-sm font-medium">
          {project.unitName}.lua
        </span>
        <div className="ml-auto flex items-center gap-2">
          {diagnostics.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className={severity ? SEVERITY_COLOR[severity] : ""}
              onClick={() => setChecksOpen(true)}
            >
              {diagnostics.length}{" "}
              {diagnostics.length === 1 ? "check" : "checks"}
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="script-tab-coverage"
                    checked={showCoverage}
                    onCheckedChange={setShowCoverage}
                    disabled={!coverageReady}
                    aria-label="Show what ran"
                  />
                  <Label
                    htmlFor="script-tab-coverage"
                    className="text-xs text-muted-foreground"
                  >
                    Show what ran
                  </Label>
                </div>
              </TooltipTrigger>
              {!coverageReady && (
                <TooltipContent>
                  Play the script once to see what it covers.
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          {owned && (
            <Button variant="outline" size="sm" onClick={onScriptRelease}>
              Discard this script and use the presets
            </Button>
          )}
        </div>
      </div>

      <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
        {owned ? (
          <>
            This unit's own script. Export writes it to{" "}
            <code>scripts/{project.unitName}.lua</code> exactly as it is here,
            if the script checkbox is ticked. A script already in the game
            folder is never overwritten.{" "}
            {unsaved ? "Not saved yet." : "Saved to the unit."}
          </>
        ) : compiled ? (
          <>
            This unit's game animates it with{" "}
            <code className="break-all">{compiled.member}</code>, which is
            compiled rather than Lua. Coilbox runs it, so what you see is what
            the game plays. It cannot be edited here and an export does not
            write it.
          </>
        ) : (
          <>
            Generated from the animations applied to this unit. Export writes it
            to <code>scripts/{project.unitName}.lua</code> too, if the script
            checkbox is ticked (on by default). An existing script is never
            overwritten, so hand edits survive a re-export.
          </>
        )}
      </p>

      {disasmError ? (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-destructive">
          The compiled script could not be disassembled: {disasmError}
        </p>
      ) : (
        // The blur handler sits here rather than on the editor itself: React's
        // blur bubbles, and `SourceEditor` has no reason to know that leaving
        // it is when an owned script gets written back. Not interactive on
        // its own account, so it needs no role: it only relays a blur that
        // already happened on the real, focusable textarea inside it.
        // biome-ignore lint/a11y/noStaticElementInteractions: relays a bubbled blur, is not itself interactive
        <div className="min-h-0 flex-1 p-3" onBlur={commit}>
          <SourceEditor
            id="script-tab-source"
            value={shown}
            onChange={owned ? setDraft : undefined}
            placeholder=""
            lines={lines}
            matches={[]}
            activeMatch={null}
            highlightLine={selectedLine === null ? null : selectedLine - 1}
            problems={lineProblems}
            readOnly={!owned}
            dimmedLines={showCoverage ? dimmedLines : undefined}
          />
        </div>
      )}

      {owned && (
        <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {empty
            ? "This script is empty, so the unit has no animation at all and the presets cannot reach it. Hand it back and the Animation panel works again."
            : "Hand the script back and the unit is generated from the animation presets again, as it was before you took it over."}{" "}
          The text above is discarded. Undo brings it back if that was a
          mistake, so copy it first if you want to keep it beyond this session.
        </p>
      )}

      {!owned && !compiled && (
        <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Take this script over and the unit keeps your version of it: you
            edit it here, and an export writes what you wrote. The animation
            presets stop applying to this unit at that point. You can hand the
            script back later, which discards what you wrote and puts the
            presets back in charge.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onScriptChange(buildLuaScript(project))}
          >
            <FileCode2 size={14} /> Take ownership of this script
          </Button>
        </div>
      )}

      <Drawer
        open={checksOpen}
        onOpenChange={setChecksOpen}
        title="Checks"
        description="Problems this script's own text carries, and where a run of it stopped."
        width="34rem"
      >
        <div className="flex flex-col gap-5 text-sm">
          <CheckSection
            title="Problems in the script"
            count={diagnostics.length}
          >
            {diagnostics.map((d, i) => (
              <CheckItem
                // biome-ignore lint/suspicious/noArrayIndexKey: a diagnostic carries no id of its own
                key={i}
                severity={d.severity}
                location={`line ${d.line}`}
                message={d.message}
                tag={d.rule}
                onSelect={() => {
                  setSelectedLine(d.line);
                  setChecksOpen(false);
                }}
              />
            ))}
          </CheckSection>
        </div>
      </Drawer>
    </div>
  );
}

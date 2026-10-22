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
 * A game's compiled script is shown as the BOS it was built from, not as the
 * opcodes it holds: BOS is the language somebody wrote it in. The COB tools
 * page is where the bytes and the instructions are, for the times that is what
 * the question is about.
 *
 * Every piece name a Lua script uses is checked against the unit, a Lua
 * script's own call-in definitions are checked against the engine's real
 * names, and a run's own error is marked against the line it names, all as
 * gutter marks with a Checks count above them. After a run, the lines it never
 * reached are shown at reduced opacity, so a glance at the editor says what a
 * preview actually exercised. Rebuilt BOS gets no such marks: a run reports
 * the instructions it reached, and one line of BOS is many of those.
 *
 * A Lua script can be imported from a file (#643). The page decides what it
 * becomes (`importScript.ts`). Once a unit owns a script, the piece names it
 * asks for that the unit lacks are listed in one line, with a way to match
 * each to one of the unit's pieces.
 */

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button, Drawer } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FileCode2, FileUp, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LintDiagnostic } from "@/animation/bindings";
import { animCobDecompileBytes } from "@/animation/bindings";
import {
  CheckItem,
  CheckSection,
  SEVERITY_COLOR,
  worstSeverity,
} from "@/components/CheckItem";
import { OptionSelect } from "@/components/OptionSelect";
import { SourceEditor } from "@/components/SourceEditor";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorText } from "@/lib/helpers";
import { usePreferredTarget } from "@/play/config";
import type { LuaMatch } from "@/scenario/pages/components/missionLuaSearch";
import { adoptGameScript } from "../../adoptGameScript";
import { legoReadTextFile } from "../../bindings";
import { hasOldPieceNumbering, isBosConversion } from "../../bosConversion";
import { lintLuaCallins } from "../../luaCallinLint";
import {
  lineNamingPiece,
  missingPieces,
  renameScriptPieces,
} from "../../luaPieces";
import { buildLuaScript, unitScript } from "../../luaScript";
import type { LegoCompiledScript, LegoProject } from "../../model";
import type { ScriptTimeline } from "../../scriptPlayback";

/** Nothing is ever found in this editor, and a fresh `[]` each render would
 *  cost the memo on `SourceEditor` its whole point. */
const NO_MATCHES: LuaMatch[] = [];

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
  /** Takes the game's compiled script again, after it has been read back out
   *  of the archive it came from. */
  onCompiledReload: (compiled: LegoCompiledScript) => void;
  /** Imports a Lua script read from a file into the unit. */
  onScriptImport: (lua: string) => void;
}

export function ScriptTab({
  project,
  onScriptChange,
  onScriptRelease,
  lastRun,
  onCompiledReload,
  onScriptImport,
}: Props) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [reloadNote, setReloadNote] = useState<string | null>(null);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const { target } = usePreferredTarget();
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

  // The BOS a compiled script was built from, rebuilt once per script. The
  // opcode listing is the truth about what runs, but nobody reads a unit in
  // opcodes: BOS is the language the script was written in, and the COB tools
  // page is where the instructions are for the times that matters.
  const [bos, setBos] = useState<string | null>(null);
  const [bosError, setBosError] = useState<string | null>(null);
  useEffect(() => {
    if (!compiled) {
      setBos(null);
      setBosError(null);
      return;
    }
    let active = true;
    animCobDecompileBytes({ bytes: compiled.bytes })
      .then((result) => {
        if (!active) return;
        setBos(result.source);
        setBosError(null);
      })
      .catch((error: unknown) => {
        if (active) setBosError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [compiled]);

  const shown = shownLua ?? bos ?? "";
  const lines = useMemo(() => shown.split("\n"), [shown]);

  // Both spellings of every piece, because a script may legitimately name
  // either. The engine takes a model's piece names exactly as the file writes
  // them, so a game's own script names `Trunk`, while coilbox lowercases them
  // and the generated script names `trunk`. An imported unit keeps the file's
  // spelling on `originalName`, and a unit opened out of a game is usually
  // carrying that game's script rather than a generated one.
  const pieceNames = useMemo(
    () =>
      project.pieces.flatMap((piece) =>
        piece.originalName ? [piece.name, piece.originalName] : [piece.name],
      ),
    [project.pieces],
  );
  const unmatched = useMemo(
    () => (owned ? missingPieces(draft, pieceNames) : []),
    [owned, draft, pieceNames],
  );

  const diagnostics = useMemo(() => {
    const found: LintDiagnostic[] = [];
    if (shownLua !== null) {
      for (const name of missingPieces(shownLua, pieceNames)) {
        found.push({
          rule: "missing-piece",
          severity: "error",
          line: lineNamingPiece(shownLua, name),
          message: t`This unit has no piece called "${name}". The engine fails to load a script that names a piece the model does not have.`,
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
    pieceNames,
    project.unitName,
    project.script,
    owned,
    lastRun,
    draft,
    t,
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

  // Why coverage cannot be shown, or null when it can. A run reports the COB
  // instructions it reached, and rebuilt BOS has no line-by-line claim on
  // those: one line of it is many instructions, and the rebuild reorders them
  // into blocks. Marking it anyway would be marking a guess.
  // Whether the marks can apply to this script at all, which is what decides
  // if the toggle is there. A run reports the lines of the Lua it ran, and a
  // compiled script is shown as rebuilt BOS: one line of that is many
  // instructions, so marking it would be marking a guess.
  const coverage = owned;
  // Ready to show, rather than merely applicable. An owned script that has not
  // been played has nothing to mark yet, and one edited since a run no longer
  // matches what that run reached.
  const coverageReady =
    coverage && lastRun !== null && draft === project.script;

  const dimmedLines = useMemo(() => {
    if (!coverageReady || !lastRun || !owned) return undefined;
    const ran = new Set(lastRun.linesRun);
    const dimmed = new Set<number>();
    lines.forEach((line, index) => {
      if (isCodeLine(line) && !ran.has(index + 1)) dimmed.add(index);
    });
    return dimmed;
  }, [coverageReady, lastRun, owned, lines]);

  // Whether reading it again is even possible: the archive has to be named on
  // the project and the engine that mounts it has to be configured.
  const fromGame = project.imported?.game;
  const gameName = fromGame?.name;
  const canReload = Boolean(compiled && fromGame?.unit && target);

  /**
   * Read the game's script again, for a unit taken out of a folder somebody is
   * still working in. The whole adoption runs rather than a narrower read,
   * because that is the one path that knows how a unit's definition names its
   * script, and only the compiled bytes are kept from it.
   */
  async function reload() {
    if (!target) return;
    setReloading(true);
    setReloadNote(null);
    try {
      const found = await adoptGameScript(project, target);
      if (found.compiled) {
        onCompiledReload(found.compiled);
        setReloadNote(null);
      } else {
        setReloadNote(
          found.notes[0] ??
            (gameName
              ? t`${gameName} no longer has a compiled script for this unit.`
              : t`The game no longer has a compiled script for this unit.`),
        );
      }
    } finally {
      setReloading(false);
    }
  }

  // A stored conversion can be made again from the game's `.bos`.
  const canConvertAgain = Boolean(
    owned && isBosConversion(project.script) && fromGame?.unit && target,
  );
  const outdated = owned && hasOldPieceNumbering(project.script);

  /**
   * Replace the stored script with a fresh conversion. Only runs once somebody
   * has confirmed, because the stored Lua may have been edited since.
   */
  async function convertAgain() {
    if (!target) return;
    setConfirmConvert(false);
    setReloading(true);
    setReloadNote(null);
    try {
      const found = await adoptGameScript(project, target);
      if (found.converted && found.script !== null) {
        onScriptChange(found.script);
      } else {
        setReloadNote(
          found.notes[0] ??
            (gameName
              ? t`${gameName} has no .bos to convert for this unit.`
              : t`The game has no .bos to convert for this unit.`),
        );
      }
    } finally {
      setReloading(false);
    }
  }

  /** Ask for a `.lua` file and hand its text to the page to import. */
  async function importFile() {
    const picked = await open({
      title: t`Import a unit script`,
      multiple: false,
      directory: false,
      filters: [{ name: t`Lua unit script`, extensions: ["lua"] }],
    });
    if (typeof picked !== "string") return;
    setReloadNote(null);
    try {
      const { text } = await legoReadTextFile({ path: picked });
      onScriptImport(text);
    } catch (error) {
      const reason = errorText(error);
      setReloadNote(t`Could not read ${picked}: ${reason}`);
    }
  }

  /** Rename the unmatched names picked so far, and keep the result. */
  function applyMapping() {
    const chosen = Object.fromEntries(
      Object.entries(mapping).filter(([from]) => unmatched.includes(from)),
    );
    setMatchOpen(false);
    setMapping({});
    if (Object.keys(chosen).length === 0) return;
    const next = renameScriptPieces(draft, chosen);
    setDraft(next);
    onScriptChange(next);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be unavailable. The text is selectable either way.
    }
  }

  const unitName = project.unitName;
  const checkCount = diagnostics.length;
  const unmatchedNames = unmatched.join(", ");
  const severity = worstSeverity(diagnostics.map((d) => d.severity));
  const unsaved = owned && draft !== project.script;
  const empty = owned && shown.trim() === "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {/* The file this is, rather than the file it would be written to: a
          compiled script is the game's own, at its own path in the archive. */}
        <span className="truncate text-sm font-medium">
          {compiled ? compiled.member : `${project.unitName}.lua`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {diagnostics.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className={severity ? SEVERITY_COLOR[severity] : ""}
              onClick={() => setChecksOpen(true)}
            >
              <Plural value={checkCount} one="# check" other="# checks" />
            </Button>
          )}
          {/* Gone entirely for a script the marks can never apply to, rather
            than sitting there switched on and dead. It stays while an owned
            script is waiting for its first run, because the tooltip is how
            anyone finds out the marks exist, but reads as off until there is
            something to show. */}
          {coverage && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="script-tab-coverage"
                      checked={showCoverage && coverageReady}
                      onCheckedChange={setShowCoverage}
                      disabled={!coverageReady}
                      aria-label={t`Show what ran`}
                    />
                    <Label
                      htmlFor="script-tab-coverage"
                      className="text-xs text-muted-foreground"
                    >
                      <Trans>Show what ran</Trans>
                    </Label>
                  </div>
                </TooltipTrigger>
                {!coverageReady && (
                  <TooltipContent>
                    <Trans>Play the script once to see what it covers.</Trans>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Only where there is something to read again. A unit imported from
            a folder is the case this is for: the file changes under coilbox
            and re-importing the whole model to see it is a lot of work for a
            script edit. */}
          {canReload && (
            <Button
              variant="outline"
              size="sm"
              disabled={reloading}
              onClick={() => void reload()}
            >
              <RefreshCw
                className={`size-4 ${reloading ? "animate-spin" : ""}`}
              />
              {reloading ? t`Reading` : t`Reload`}
            </Button>
          )}
          {canConvertAgain && (
            <Popover open={confirmConvert} onOpenChange={setConfirmConvert}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={reloading}>
                  <RefreshCw
                    className={`size-4 ${reloading ? "animate-spin" : ""}`}
                  />
                  {reloading ? t`Converting` : t`Convert again`}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-72 flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">
                    <Trans>Replace this script?</Trans>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      It is converted from the game's BOS again. Edits you made
                      since are lost.
                    </Trans>
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmConvert(false)}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void convertAgain()}
                  >
                    <Trans>Replace</Trans>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={reloading}
            onClick={() => void importFile()}
          >
            <FileUp className="size-4" />
            <Trans>Import</Trans>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? t`Copied` : t`Copy`}
          </Button>
          {owned && (
            <Button variant="outline" size="sm" onClick={onScriptRelease}>
              <Trans>Discard this script and use the presets</Trans>
            </Button>
          )}
        </div>
      </div>

      {/* Nothing for a compiled script. The file name above already says what
        it is, and the editor being read-only says the rest. */}
      {compiled ? null : (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {owned ? (
            <>
              <Trans>
                This unit's own script. Export writes it to{" "}
                <code>scripts/{unitName}.lua</code> exactly as it is here, if
                the script checkbox is ticked. A script already in the game
                folder is never overwritten.
              </Trans>{" "}
              {unsaved ? (
                <Trans>Not saved yet.</Trans>
              ) : (
                <Trans>Saved to the unit.</Trans>
              )}
            </>
          ) : (
            <Trans>
              Generated from the animations applied to this unit. Export writes
              it to <code>scripts/{unitName}.lua</code> too, if the script
              checkbox is ticked (on by default). An existing script is never
              overwritten, so hand edits survive a re-export.
            </Trans>
          )}
        </p>
      )}

      {outdated && (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-amber-500">
          <Trans>
            Converted before piece numbers were fixed. Convert again.
          </Trans>
        </p>
      )}

      {unmatched.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-amber-500">
          <span className="min-w-0 flex-1 truncate">
            <Trans>Not on this unit: {unmatchedNames}.</Trans>
          </span>
          <Popover open={matchOpen} onOpenChange={setMatchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Trans>Match pieces</Trans>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 flex-col gap-3">
              {unmatched.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-28 truncate font-mono text-xs">
                    {name}
                  </span>
                  <OptionSelect
                    size="sm"
                    ariaLabel={t`Piece for ${name}`}
                    placeholder={t`Leave it`}
                    value={mapping[name] ?? ""}
                    onValueChange={(to) =>
                      setMapping((was) => ({ ...was, [name]: to }))
                    }
                    options={project.pieces.map((piece) => ({
                      value: piece.name,
                      label: piece.name,
                    }))}
                  />
                </div>
              ))}
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={applyMapping}>
                  <Trans>Rename</Trans>
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {reloadNote && (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-amber-500">
          {reloadNote}
        </p>
      )}

      {bosError ? (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-destructive">
          <Trans>
            The compiled script could not be read back as BOS: {bosError}
          </Trans>
        </p>
      ) : (
        // The blur handler sits here rather than on the editor itself: React's
        // blur bubbles, and `SourceEditor` has no reason to know that leaving
        // it is when an owned script gets written back. Not interactive on
        // its own account, so it needs no role: it only relays a blur that
        // already happened on the real, focusable textarea inside it.
        // biome-ignore lint/a11y/noStaticElementInteractions: relays a bubbled blur, is not itself interactive
        <div className="flex min-h-0 flex-1 p-3" onBlur={commit}>
          <SourceEditor
            id="script-tab-source"
            value={shown}
            onChange={owned ? setDraft : undefined}
            placeholder=""
            lines={lines}
            matches={NO_MATCHES}
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
          {empty ? (
            <Trans>
              This script is empty, so the unit has no animation at all and the
              presets cannot reach it. Hand it back and the Animation panel
              works again.
            </Trans>
          ) : (
            <Trans>
              Hand the script back and the unit is generated from the animation
              presets again, as it was before you took it over.
            </Trans>
          )}{" "}
          <Trans>
            The text above is discarded. Undo brings it back if that was a
            mistake, so copy it first if you want to keep it beyond this
            session.
          </Trans>
        </p>
      )}

      {!owned && !compiled && (
        <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            <Trans>
              Take this script over to edit it. The unit then keeps your
              version, an export writes what you wrote, and the presets stop
              generating it. You do not need to take it over to see the unit
              run, because the Animation panel already plays this script. You
              can hand it back later, which discards your version and puts the
              presets back in charge.
            </Trans>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onScriptChange(buildLuaScript(project))}
          >
            <FileCode2 size={14} /> <Trans>Take ownership of this script</Trans>
          </Button>
        </div>
      )}

      <Drawer
        open={checksOpen}
        onOpenChange={setChecksOpen}
        title={t`Checks`}
        description={t`Problems this script's own text carries, and where a run of it stopped.`}
        width="34rem"
      >
        <div className="flex flex-col gap-5 text-sm">
          <CheckSection
            title={t`Problems in the script`}
            count={diagnostics.length}
          >
            {diagnostics.map((d, i) => {
              const line = d.line;
              return (
                <CheckItem
                  // biome-ignore lint/suspicious/noArrayIndexKey: a diagnostic carries no id of its own
                  key={i}
                  severity={d.severity}
                  location={t`line ${line}`}
                  message={d.message}
                  tag={d.rule}
                  onSelect={() => {
                    setSelectedLine(d.line);
                    setChecksOpen(false);
                  }}
                />
              );
            })}
          </CheckSection>
        </div>
      </Drawer>
    </div>
  );
}

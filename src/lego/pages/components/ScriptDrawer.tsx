/**
 * The unit script: the one the animations generate, or the one the user owns.
 *
 * A unit starts with a generated script, shown here to read and copy. Taking
 * ownership hands it over: from then on this is an editor, the text is stored
 * on the unit, and an export writes exactly what is in it. That is a one way
 * door, so the panel says so next to the button rather than in a warning.
 *
 * Editing is a textarea, not a code editor. Every piece name the script uses is
 * checked against the unit, because a name the model does not have fails at
 * load in the engine, and that is worth catching here.
 */

import { Button } from "@picoframe/frame";
import { Check, Copy, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { missingPieces } from "../../luaPieces";
import { buildLuaScript, unitScript } from "../../luaScript";
import type { LegoProject } from "../../model";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  /** Stores the unit's own Lua. The first call is the unit taking it over. */
  onScriptChange: (script: string) => void;
}

export function ScriptDrawer({
  open,
  onOpenChange,
  project,
  onScriptChange,
}: Props) {
  const [copied, setCopied] = useState(false);
  const owned = project.script !== undefined;
  const [draft, setDraft] = useState(project.script ?? "");

  // Follow the document when it changes underneath, which is what taking
  // ownership and an undo both look like from here.
  useEffect(() => setDraft(project.script ?? ""), [project.script]);

  const shown = owned ? draft : unitScript(project);
  const missing = missingPieces(
    shown,
    project.pieces.map((piece) => piece.name),
  );
  const unsaved = owned && draft !== project.script;

  function commit() {
    if (draft !== project.script) onScriptChange(draft);
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

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Closing keeps the work, however it was closed: the Escape key never
        // reaches the textarea's blur.
        if (!next) commit();
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[95vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              {project.unitName}.lua
            </DialogPrimitive.Title>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          <p className="border-b border-border/60 px-5 py-2 text-xs text-muted-foreground">
            {owned ? (
              <>
                This unit's own script. Export writes it to{" "}
                <code>scripts/{project.unitName}.lua</code> exactly as it is
                here, if the script checkbox is ticked. A script already in the
                game folder is never overwritten.
              </>
            ) : (
              <>
                Generated from the animations applied to this unit. Export
                writes it to <code>scripts/{project.unitName}.lua</code> too, if
                the script checkbox is ticked (on by default). An existing
                script is never overwritten, so hand edits survive a re-export.
              </>
            )}
          </p>

          {owned ? (
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              spellCheck={false}
              aria-label={`${project.unitName}.lua`}
              className="min-h-0 flex-1 field-sizing-fixed resize-none rounded-none border-0 px-5 py-4 font-mono text-xs leading-relaxed shadow-none focus-visible:ring-0"
            />
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto px-5 py-4 text-xs leading-relaxed">
              <code>{shown}</code>
            </pre>
          )}

          {missing.length > 0 ? (
            <p className="border-t border-border/60 px-5 py-2 text-xs text-destructive">
              This unit has no piece called{" "}
              {missing.map((name) => `"${name}"`).join(", ")}. The engine fails
              to load a script that names a piece the model does not have.
            </p>
          ) : null}

          {owned ? (
            <p className="border-t border-border/60 px-5 py-2 text-xs text-muted-foreground">
              {unsaved ? "Not saved yet" : "Saved to the unit"}
            </p>
          ) : (
            <div className="flex flex-col gap-2 border-t border-border/60 px-5 py-4">
              <span className="text-sm font-medium">Write it yourself</span>
              <p className="text-xs text-muted-foreground">
                Take this script over and the unit keeps your version of it: you
                edit it here, and an export writes what you wrote. The animation
                presets stop applying to this unit at that point, and there is
                no way back to them.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onScriptChange(buildLuaScript(project))}
              >
                Take ownership of this script
              </Button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

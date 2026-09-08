/**
 * Decoding a stranger's tweak payload back to Lua (issue #1280).
 *
 * The inverse of `PackageMutatorButton`'s BAR mode (issue #1277): that one
 * packs a project into `!bset` lines to hand to somebody else, this one
 * reads one back. It lives on the projects list rather than inside an
 * editor, because decoding a blob is something you do before you have a
 * project: a friend pastes a line, or a lobby's mod options panel shows one,
 * and the honest first question is what it actually does, not which
 * existing project it belongs to.
 *
 * Every slot is shown as Lua regardless of what it turned out to be
 * (`decodeTweakSet.ts` never withholds text it managed to decode), and the
 * form badge says which of the three things happened to it. Starting a
 * project is only offered once something decoded to a shape this app can
 * act on: a data table becomes new units, and a program or anything
 * unrecognised is carried along as read-only Lua rather than dropped.
 */
import { Button, Drawer } from "@picoframe/frame";
import { Check, Copy, FileCode2 } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { Textarea } from "@/components/ui/textarea";
import {
  allSlots,
  type DecodedSlot,
  type DecodedTweakSet,
  multiLineEntries,
  pastedEntry,
  planProjectFromDecoded,
  slotTitle,
  workshopDecodeTweakSet,
} from "../../decodeTweakSet";
import type { NewProject } from "../../project";

type Phase =
  | { state: "idle" }
  | { state: "decoding" }
  | { state: "done"; set: DecodedTweakSet }
  | { state: "failed"; message: string };

/** One press to put a slot's Lua on the clipboard. Local to this file the
 *  same way `PackageMutatorButton`'s own copy button is. */
function CopyLuaButton({ lua }: { lua: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-6 shrink-0 gap-1 px-2"
      aria-label="Copy this Lua"
      onClick={() => {
        navigator.clipboard
          .writeText(lua)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** What a slot turned out to be, in the same three-way split
 *  `decode.rs`'s own doc comment draws. */
function FormBadge({ slot }: { slot: DecodedSlot }) {
  if (slot.error) {
    return (
      <span className="shrink-0 text-xs text-destructive">Not decoded</span>
    );
  }
  if (slot.form === "table") {
    return (
      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
        Data table
      </span>
    );
  }
  if (slot.form === "block") {
    return (
      <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
        Program, read only
      </span>
    );
  }
  return (
    <span className="shrink-0 text-xs text-muted-foreground">Unrecognised</span>
  );
}

function SlotCard({ slot }: { slot: DecodedSlot }) {
  return (
    <li className="flex flex-col gap-1.5 rounded border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium" title={slot.key}>
          {slotTitle(slot)}
        </span>
        <FormBadge slot={slot} />
      </div>
      {slot.error ? (
        <p className="text-xs text-destructive">{slot.error}</p>
      ) : (
        <>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-xs">
            {slot.lua}
          </pre>
          {slot.lua ? (
            <div className="flex justify-end">
              <CopyLuaButton lua={slot.lua} />
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}

export function DecodeTweakSetDrawer({
  games,
  scanning,
  onStarted,
}: {
  /** The installed games, for the picker a decoded set of units is filed
   *  under: nothing about a payload names its own game. */
  games: readonly { name: string }[];
  scanning: boolean;
  /** Called with what a decoded set turned into, so the page can create and
   *  open the project the way it does for any other import. */
  onStarted: (input: NewProject) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [gameName, setGameName] = useState("");
  const [phase, setPhase] = useState<Phase>({ state: "idle" });

  async function run() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPhase({ state: "decoding" });
    try {
      const entries = trimmed.includes("\n")
        ? multiLineEntries(trimmed)
        : pastedEntry(trimmed);
      const set = await workshopDecodeTweakSet({ entries });
      setPhase({ state: "done", set });
    } catch (error) {
      setPhase({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const plan =
    phase.state === "done" ? planProjectFromDecoded(phase.set) : null;
  const nothingToStart =
    !plan || (plan.clones.length === 0 && plan.readOnlyLua.length === 0);

  function startProject() {
    if (!plan || !gameName) return;
    onStarted({
      name: `${gameName} tweaks, decoded`,
      gameName,
      ...(plan.clones.length > 0
        ? {
            edits: {
              overrides: {},
              clones: Object.fromEntries(
                plan.clones.map((clone) => [clone.key, clone]),
              ),
              menus: {},
              text: {},
              disabled: [],
            },
          }
        : {}),
      ...(plan.readOnlyLua.length > 0 ? { readOnlyLua: plan.readOnlyLua } : {}),
    });
    setOpen(false);
    setText("");
    setGameName("");
    setPhase({ state: "idle" });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        title="Decode a base64 tweak payload, or a set of a battle's mod options, back to Lua"
      >
        <FileCode2 className="mr-1 size-3.5" />
        Decode
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Decode a tweak set"
        description="Paste a payload a lobby showed you, a whole !bset line, or several lines copied out of a battle's mod options. Coilbox shows the Lua and, where the shape allows, turns it into an editable project."
        width="26rem"
      >
        <div className="flex flex-col gap-4">
          <Field
            label="Payload"
            hint="One line for a single payload, or several for a whole set of slots."
          >
            <Textarea
              aria-label="Tweak payload to decode"
              value={text}
              placeholder="!bset tweakdefs3 eyJ..."
              className="min-h-24 font-mono text-xs"
              onChange={(event) => setText(event.target.value)}
            />
          </Field>

          <Button
            onClick={() => void run()}
            disabled={!text.trim() || phase.state === "decoding"}
          >
            <FileCode2 className="size-4" />
            {phase.state === "decoding" ? "Decoding" : "Decode"}
          </Button>

          {phase.state === "failed" ? (
            <p className="text-xs text-destructive">{phase.message}</p>
          ) : null}

          {phase.state === "done" ? (
            allSlots(phase.set).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing there matched a tweakdefs or tweakunits slot.
              </p>
            ) : (
              <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
                <ul className="flex flex-col gap-2">
                  {allSlots(phase.set).map((slot, index) => (
                    // A decode result is stable once it lands and slots do
                    // not reorder under the user's cursor.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    <SlotCard key={index} slot={slot} />
                  ))}
                </ul>

                {nothingToStart ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing here decoded to a shape coilbox can carry into a
                    project.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Field
                      label="Game"
                      hint="Nothing in a payload says which game it is for."
                    >
                      <OptionSelect
                        size="sm"
                        ariaLabel="Game for the decoded project"
                        placeholder={scanning ? "Scanning…" : "Pick a game"}
                        value={gameName}
                        onValueChange={setGameName}
                        options={games.map((g) => ({
                          value: g.name,
                          label: g.name,
                        }))}
                      />
                    </Field>
                    <Button onClick={startProject} disabled={!gameName}>
                      Start a project from this
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : null}
        </div>
      </Drawer>
    </>
  );
}

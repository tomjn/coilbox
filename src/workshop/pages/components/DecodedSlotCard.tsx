/**
 * One decoded tweak slot, shown the same way wherever a decode result lands
 * (issue #1280, and the battle-room entry point added for issue #2756):
 * verbatim Lua, a copy button, and a badge for which of the three shapes it
 * turned out to be. Split out of `DecodeTweakSetDrawer.tsx` so the battle
 * room's own read-only view does not have to redraw the same card.
 */
import { Button } from "@picoframe/frame";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { DecodedSlot } from "../../decodeTweakSet";
import { slotTitle } from "../../decodeTweakSet";

/** One press to put a slot's Lua on the clipboard. */
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

export function SlotCard({ slot }: { slot: DecodedSlot }) {
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

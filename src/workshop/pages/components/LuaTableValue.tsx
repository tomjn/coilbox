/**
 * A unit field whose value is a table, shown as the Lua the game wrote (issue
 * #2695).
 *
 * Before this the row was `JSON.stringify` in a `truncate`d `code` element, so
 * a sound table or a weapon mount showed its first forty characters and there
 * was no way to reach the rest. Lua rather than JSON because the value came out
 * of the game's Lua and goes back as Lua, and a modder comparing this against
 * the game's own file should be reading one syntax, not two.
 *
 * Read-only. Making a table editable is a different and larger problem, since a
 * table has no obvious inherited-and-overridden behaviour, and the issue puts it
 * out of scope.
 *
 * Small tables are shown where they are and large ones open in a drawer. The cut
 * is measured rather than picked. Serialising every table-valued field of every
 * unit in Balanced Annihilation (1,260 fields across 374 units) and Beyond All
 * Reason (4,733 across 982) one key per line, the share that fits goes 8% -> 20%
 * -> 23% in BA and 13% -> 30% -> 34% in BAR as the cut moves 6 -> 8 -> 10 lines.
 * Eight sits at the top of the one big step in both games: it takes in the whole
 * cluster of small tables, and going further buys almost nothing per line of
 * page it costs. The real count is lower still, because a table of nothing but
 * scalars stays on one line.
 *
 * `customParams` never reaches here. `unitSections.ts` walks into it and draws a
 * row per key, so each key keeps the note naming the gadget that reads it
 * (issue #2661), and each of those values is a scalar with its own control.
 */
import { Button, cn } from "@picoframe/frame";
import { Check, Copy, PanelRightOpen, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { luaLiteral } from "@/lib/lua";

/** Lines of Lua above which a table opens in a drawer instead of in the row.
 *  Measured against both games, see the note at the top of this file. */
const INLINE_MAX_LINES = 8;

/** What the table holds, in the fewest words that let someone decide whether to
 *  open it. */
function summarise(
  value: Record<string, unknown> | unknown[],
  lines: number,
): string {
  const n = Array.isArray(value) ? value.length : Object.keys(value).length;
  const noun = Array.isArray(value)
    ? n === 1
      ? "entry"
      : "entries"
    : n === 1
      ? "key"
      : "keys";
  return `${n} ${noun}, ${lines} lines of Lua`;
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be refused. The Lua is on screen and selectable.
    }
  };
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={copy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function LuaTableDrawer({
  code,
  label,
  path,
  open,
  onOpenChange,
}: {
  code: string;
  label: string;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[44rem] max-w-[95vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <DialogPrimitive.Title className="truncate text-base font-semibold">
                {label}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate font-mono text-xs text-muted-foreground">
                {path}
              </DialogPrimitive.Description>
            </div>
            <CopyButton code={code} />
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <CodeBlock
              code={code}
              lang="lua"
              label={`${label} as Lua`}
              className="h-full rounded-lg border border-border/50 [&_pre]:min-h-full"
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function LuaTableValue({
  value,
  label,
  path,
}: {
  /** The table itself, as it was decoded from the game's Lua. */
  value: Record<string, unknown> | unknown[];
  /** The field's label, for the drawer's heading and the screen reader. */
  label: string;
  /** The access path into the def, which is what the reader searches the
   *  game's own files for. */
  path: string;
}) {
  const code = useMemo(() => luaLiteral(value), [value]);
  const lines = code.split("\n").length;
  const [open, setOpen] = useState(false);

  if (lines <= INLINE_MAX_LINES) {
    return (
      <CodeBlock
        code={code}
        lang="lua"
        label={`${label} as Lua`}
        className={cn(
          "rounded border border-border/50",
          // Wide values wrap rather than reaching off the row, since there is
          // no horizontal scrollbar to find inside a form.
          "[&_pre]:whitespace-pre-wrap",
        )}
      />
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-full justify-start gap-2 font-normal text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label={`Read ${label} as Lua`}
      >
        {/* A panel opening, not braces. Braces beside "3 keys" reads as an
            empty table at a glance, and the words already say it is one. */}
        <PanelRightOpen className="size-3.5 shrink-0" />
        <span className="truncate text-xs">{summarise(value, lines)}</span>
      </Button>
      {open && (
        <LuaTableDrawer
          code={code}
          label={label}
          path={path}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

/**
 * The unit script a unit's animations generate.
 *
 * Shown rather than written. Export puts a model in a game folder and nothing
 * else, so where this file belongs is the reader's decision, not ours. Copy it
 * into the game's `scripts/` folder as `<unit>.lua`.
 */

import { Button } from "@picoframe/frame";
import { Check, Copy, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import { buildLuaScript } from "../../luaScript";
import type { LegoProject } from "../../model";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
}

export function ScriptDrawer({ open, onOpenChange, project }: Props) {
  const [copied, setCopied] = useState(false);
  const lua = buildLuaScript(project);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lua);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be unavailable. The text is selectable either way.
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
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
            Put this in the game's <code>scripts</code> folder. Export writes
            the model and its texture, not this, so editing it by hand is safe.
          </p>

          <pre className="min-h-0 flex-1 overflow-auto px-5 py-4 text-xs leading-relaxed">
            <code>{lua}</code>
          </pre>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

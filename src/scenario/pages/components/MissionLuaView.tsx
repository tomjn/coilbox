/**
 * The mission file the engine is handed, shown to be read (issue #2163).
 *
 * `compileScenario` already turns a document into the exact text that gets
 * written into the game archive, and until now the only copy of it was the one
 * inside that archive. So the same function runs here and its output is put on
 * screen, which needs no launch, no engine and no write.
 *
 * The text is selectable as well as copyable, because the clipboard can be
 * unavailable and a reader who only wants one line should not have to take the
 * whole file to get it.
 */

import { Button } from "@picoframe/frame";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { compileScenario, missionPath } from "../../compile";
import type { Scenario } from "../../model";

/** How long the copy button says it copied before going back to offering. */
const COPIED_MS = 1500;

/**
 * Compile a document, or say why it would not compile.
 *
 * The compiler throws on a document it cannot emit, and a mission that will not
 * compile is exactly the mission somebody opens this to look at, so the throw is
 * caught and reported rather than taking the editor down with it.
 */
export function compiledMissionText(scenario: Scenario): {
  lua: string;
  error?: string;
} {
  try {
    return { lua: compileScenario(scenario) };
  } catch (e) {
    return { lua: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export function MissionLuaView({ scenario }: { scenario: Scenario }) {
  const { lua, error } = useMemo(
    () => compiledMissionText(scenario),
    [scenario],
  );
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lua);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // The clipboard can be unavailable. The text below is selectable either
      // way, so there is nothing to report and nothing to fix.
    }
  };

  return (
    // Fills the drawer's body so the file itself is what scrolls. Left to grow,
    // the drawer scrolls instead and the copy button leaves with it: a mission
    // is thousands of lines and the button would be at the top of all of them.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          What the mission runtime reads, compiled from this document. It is
          written into the game as{" "}
          <code className="font-mono">{missionPath(scenario.id)}</code> when the
          mission is played.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={error !== undefined}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-destructive">
          This document does not compile: {error}
        </p>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs leading-relaxed">
          <code>{lua}</code>
        </pre>
      )}
    </div>
  );
}

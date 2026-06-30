import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useUnitsyncLuaExec } from "../../config";

const DEFAULT_SCRIPT = 'return { hello = "world" }';

/**
 * Drawer body for the Archives detail "Lua Console". Runs the typed Lua through
 * unitsync's restricted parser with the page's archive mounted, and shows the
 * returned value or the parser error. Scoped entirely by props — the archive is
 * fixed by whichever detail page opened the drawer.
 */
export function LuaConsoleDrawer({
  enginePath,
  dataDir,
  archive,
}: {
  enginePath: string;
  dataDir: string;
  archive: string;
}) {
  const [source, setSource] = useState(DEFAULT_SCRIPT);
  const { run, result, loading } = useUnitsyncLuaExec(
    enginePath,
    dataDir,
    archive,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Runs in unitsync's restricted Lua parser with{" "}
        <span className="font-mono">{archive}</span> mounted. End your script
        with <span className="font-mono">return …</span> to see a value. Many
        engine APIs are unavailable; there is no persistent state between runs.
      </p>

      <Textarea
        value={source}
        spellCheck={false}
        aria-label="Lua source"
        className="min-h-40 font-mono text-xs"
        onChange={(e) => setSource(e.target.value)}
      />

      <Button
        size="sm"
        className="gap-1.5 self-start"
        disabled={loading}
        onClick={() => run(source)}
      >
        <Play className="size-4" /> {loading ? "Running…" : "Run"}
      </Button>

      {result?.error != null && (
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
          {result.error}
        </pre>
      )}

      {result?.result != null && (
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-card p-3 font-mono text-xs">
          {result.result}
        </pre>
      )}

      {result?.errors != null && result.errors.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Diagnostics ({result.errors.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1 font-mono">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

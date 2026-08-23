import { Button } from "@picoframe/frame";
import { ClipboardCopy, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { contentOpenPath } from "@/content/bindings";
import { type InfologTail, playInfolog } from "@/play/bindings";
import { usePreferredTarget } from "@/play/config";
import { InfologView } from "./components/InfologView";

/** How many lines to read. Enough to cover a whole session's loading plus
 * whatever went wrong at the end of it. */
const TAIL_LINES = 500;

/** A log's timestamp, in the reader's own locale. */
function when(ms: number): string {
  return new Date(ms).toLocaleString();
}

/**
 * The engine's last log, on demand (issue #379).
 *
 * The crash drawer covers "it just died". This covers "it worked yesterday":
 * the log outlives the session, so it is still here the next morning, and
 * nothing has to have crashed for somebody to want to read it.
 *
 * It shows the same log the crash drawer would, found the same way. The engine
 * writes it to its own write dir rather than to the content root, so this is
 * also the quickest way to find out where that is.
 */
export default function EngineLogSection() {
  const { target } = usePreferredTarget();
  const dataDir = target?.dataDir;
  const [log, setLog] = useState<InfologTail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (dataDir == null) return;
    setLoading(true);
    setCopied(false);
    try {
      const { log } = await playInfolog({ dataDir, maxLines: TAIL_LINES });
      setLog(log);
      setError(null);
    } catch (e) {
      setLog(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dataDir]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!target) {
    return (
      <p className="text-sm text-muted-foreground">
        No engine is installed, so nothing has written a log yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className="size-4" /> {loading ? "Reading" : "Reload"}
        </Button>
        {log ? (
          <>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard
                  .writeText(log.lines.join("\n"))
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              <ClipboardCopy className="size-4" />
              {copied ? "Copied" : "Copy the log"}
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void contentOpenPath({ path: log.path }).catch(() => {});
              }}
            >
              <ExternalLink className="size-4" /> Open the log file
            </Button>
          </>
        ) : null}
      </div>

      {log ? (
        <>
          <p className="break-all text-xs text-muted-foreground">
            <code>{log.path}</code>, written {when(log.modifiedMs)}
          </p>
          <InfologView log={log} className="max-h-[60vh]" />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {error ?? "Reading the engine log."}
        </p>
      )}
    </div>
  );
}

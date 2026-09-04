import { Button } from "@picoframe/frame";
import { FolderInput, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBytes } from "@/lib/format";
import { notify } from "@/notify/notify";
import { contentGatherReplays, type GatherSummary } from "../../bindings";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** One line saying what a gather covers, preview or applied. */
function summarize(s: GatherSummary): string {
  const n = s.moved.length;
  if (n === 0) {
    // Nothing moving and nothing left behind is a tidy install. Nothing moving
    // with something left behind is a different answer, and the reasons are
    // listed under it.
    return s.skipped.length > 0
      ? "Nothing can move right now."
      : "Every replay is already in one folder.";
  }
  const files = `${n} ${n === 1 ? "replay" : "replays"}`;
  return `${s.applied ? "Moved" : "Can move"} ${files} (${formatBytes(s.bytes)}).`;
}

/**
 * "Gather replays" control for the Replays screen (issue #971).
 *
 * An engine coilbox installed is its own write dir, so it records into a `demos/`
 * folder inside its own version folder. The list shows those alongside everything
 * else, so a player cannot tell (#966), and deleting that engine folder to make
 * space takes their game history with it. Nothing in coilbox deletes an engine,
 * so that happens in Finder, where no warning of coilbox's could reach.
 *
 * Opening it previews. Only an explicit confirm moves anything, and then it says
 * how many went, because moving a player's files quietly is the thing to avoid.
 * Anything it will not move is listed with the reason.
 */
export function GatherReplaysButton({
  rootPath,
  onGathered,
}: {
  /** The content root to gather into, or undefined when none is selected. */
  rootPath?: string;
  /** Re-read the list, so the moved files show their new home. */
  onGathered: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<GatherSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next || !rootPath) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    contentGatherReplays({ root: rootPath, apply: false })
      .then((r) => setPreview(r.summary))
      .catch((e) => setError(msg(e)))
      .finally(() => setLoading(false));
  };

  const apply = async () => {
    if (!rootPath) return;
    setApplying(true);
    setError(null);
    try {
      const { summary } = await contentGatherReplays({
        root: rootPath,
        apply: true,
      });
      void notify({ title: summarize(summary), level: "success" });
      setOpen(false);
      onGathered();
    } catch (e) {
      setError(msg(e));
    } finally {
      setApplying(false);
    }
  };

  const nothing = preview !== null && preview.moved.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!rootPath}
          title="Move replays out of the engine folders into your content folder"
        >
          <FolderInput className="size-4" />
          Gather replays
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Looking for replays inside the engine folders...
          </p>
        ) : error ? (
          <p className="break-words text-sm text-destructive">{error}</p>
        ) : preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{summarize(preview)}</p>
            {!nothing && (
              <p className="text-xs text-muted-foreground">
                Some engines record into their own folder, so deleting that
                engine deletes those replays. This moves them into the demos
                folder alongside the rest.
              </p>
            )}
            {preview.skipped.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  Staying where they are:
                </p>
                <ul className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                  {preview.skipped.map((line) => (
                    <li key={line} className="break-words font-mono">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                {nothing ? "Close" : "Cancel"}
              </Button>
              {!nothing && (
                <Button
                  type="button"
                  size="sm"
                  disabled={applying}
                  onClick={apply}
                >
                  {applying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FolderInput className="size-4" />
                  )}
                  Move them
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

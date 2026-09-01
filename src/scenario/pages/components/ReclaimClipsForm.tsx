import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadedCampaigns } from "../../../campaign/campaigns";
import {
  namedScenarioClips,
  previewOrphanedScenarioMedia,
  sweptCount,
} from "../../../campaign/scenarioMedia";
import { formatBytes } from "../../../content/rapidPool";
import type { MediaSweepSummary } from "../../bindings";
import { listScenarios, sweepScenarioMedia } from "../../storage";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** One line saying what a sweep covers, dry run or applied. */
function summarize(s: MediaSweepSummary): string {
  const n = sweptCount(s);
  if (n === 0) return "No leftover dialogue clips - nothing to reclaim.";
  const clips = `${n} ${n === 1 ? "clip" : "clips"}`;
  return `${s.applied ? "Removed" : "Can reclaim"} ${clips} (${formatBytes(s.bytes)}).`;
}

/**
 * "Reclaim clips" for the Scenario Builder, as the body of a drawer.
 *
 * Deleting a scenario a campaign mission attached keeps its clips, and so does
 * replacing one that a mission still names, because the mission plays the file
 * by name. Detaching or deleting that mission afterwards leaves the file with
 * nothing naming it (issue #916). The start-of-session sweep collects those, but
 * only once and only on the next start, so an author who has just deleted the
 * mission can clear them here and see what went first.
 *
 * It dry-runs the sweep as it mounts and previews the result. Only an explicit
 * confirm deletes. Both halves read the campaigns and the stored scenarios
 * fresh, because a keep set a failed read left short would take a live clip.
 *
 * A drawer rather than the popover this used to hang off its own header button.
 * The header button is now a menu item (issue #2184), and the menu has closed by
 * the time the preview is on screen, so there is nothing left for a popover to
 * point at. Same move the row menu makes for its delete confirmation.
 *
 * It stays on the builder's list page rather than going to Settings because that
 * is the one place with no scenario editor mounted: the editor writes an
 * imported clip to disk before the document naming it is saved, so a sweep
 * alongside it could take a file that is about to be named.
 */
export function ReclaimClipsForm({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<MediaSweepSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const campaigns = await loadedCampaigns();
      setPreview(
        await previewOrphanedScenarioMedia(campaigns.map((c) => c.campaign)),
      );
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the preview is taken once, when the drawer opens
  useEffect(() => {
    void runDryRun();
  }, []);

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const campaigns = await loadedCampaigns();
      const summary = await sweepScenarioMedia(
        namedScenarioClips(
          (await listScenarios()).map((l) => l.scenario),
          campaigns.map((c) => c.campaign),
        ),
        true,
      );
      toast.success(summarize(summary));
      onDone();
    } catch (e) {
      setError(msg(e));
    } finally {
      setApplying(false);
    }
  };

  const clean = preview !== null && sweptCount(preview) === 0;

  if (loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Looking for leftover dialogue clips...
      </p>
    );
  if (error)
    return <p className="break-words text-sm text-destructive">{error}</p>;
  if (!preview) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{summarize(preview)}</p>
      {!clean && (
        <p className="text-xs text-muted-foreground">
          Portraits and voice clips that no stored scenario and no campaign
          mission names. This can't be undone.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {clean ? "Close" : "Cancel"}
        </Button>
        {!clean && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={applying}
            onClick={apply}
          >
            {applying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Reclaim
          </Button>
        )}
      </div>
    </div>
  );
}

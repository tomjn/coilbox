import { Button } from "@picoframe/frame";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { scenarioContents } from "@/scenario/listing";
import { attachScenario, type ScenarioAttachment } from "../../missionScenario";
import type { CampaignMission } from "../../model";

/** An attachment whose source scenario is still here and has moved on. */
export type StaleAttachment = Extract<ScenarioAttachment, { state: "stale" }>;

/** An edit timestamp in the reader's own locale, or nothing when unstamped. */
export function editedAt(iso: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Re-copy the stored scenario into a mission whose copy has fallen behind
 * (issue #2199).
 *
 * The mission row already said the scenario had been edited since, and left the
 * author to work out what to do about it. The answer was buried in the mission
 * editor drawer, so this puts it beside the sentence that reports the problem.
 *
 * It only takes a stale attachment, which is what keeps it honest: an orphaned
 * mission has no stored scenario left to copy from, and offering a button that
 * cannot run is worse than offering nothing.
 *
 * Confirmed rather than immediate, because this is not reversible. The copy
 * being overwritten is the only one of itself, so anything the builder's
 * document has since dropped goes with it, and the editor has no undo. The
 * popover therefore says what changes rather than asking "are you sure?".
 */
export function MissionScenarioUpdateButton({
  mission,
  attachment,
  onUpdate,
}: {
  mission: CampaignMission;
  /** Both documents: the copy the mission plays, and the one stored now. */
  attachment: StaleAttachment;
  /** Stores the re-copied mission. Reports its own failures. */
  onUpdate: (mission: CampaignMission) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { snapshot, live } = attachment;
  // Attaching takes the scenario's setup as the mission's launch snapshot, so a
  // scenario that moved to another game or map moves the mission with it.
  const gameMoved = mission.snapshot.gameName !== live.setup.gameName;
  const mapMoved = mission.snapshot.mapName !== live.setup.mapName;

  // Whoever owns the save shows the error banner for a failed one, so there is
  // nothing to report in here.
  const update = async () => {
    setBusy(true);
    await onUpdate(attachScenario(mission, live));
    setBusy(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          aria-label={`Update to latest: ${mission.title}`}
        >
          <RefreshCw className="size-4" /> Update to latest
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-96 flex-col gap-3">
        <div className="flex flex-col gap-2">
          <h3 className="break-words text-sm font-medium">
            Update to the latest &quot;{live.name}&quot;?
          </h3>
          <p className="text-xs text-muted-foreground">
            This mission plays a copy taken on{" "}
            {editedAt(snapshot.updatedAt) || "an earlier date"}. Updating
            replaces that copy with the scenario as the builder holds it now,
            edited on {editedAt(live.updatedAt) || "a later date"}. There is no
            undo, and no other copy of what the mission is playing, so anything
            the builder&apos;s version has dropped goes with it.
          </p>
          <div className="flex flex-col gap-0.5 rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground">
            <span className="break-words">
              <span className="font-medium text-foreground">Attached</span>{" "}
              {scenarioContents(snapshot)}
            </span>
            <span className="break-words">
              <span className="font-medium text-foreground">Latest</span>{" "}
              {scenarioContents(live)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            The mission keeps its own title, briefing, objectives and images.
          </p>
          {(gameMoved || mapMoved) && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {gameMoved &&
                `The mission's game changes from ${mission.snapshot.gameName || "none"} to ${live.setup.gameName || "none"}. `}
              {mapMoved &&
                `The mission's map changes from ${mission.snapshot.mapName || "none"} to ${live.setup.mapName || "none"}. `}
              {gameMoved &&
                mission.disabledUnits.length > 0 &&
                "Its unit restrictions name units from the game it is leaving, so they will not apply."}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={() => void update()}
          >
            <RefreshCw className="size-4" /> {busy ? "Updating…" : "Update"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

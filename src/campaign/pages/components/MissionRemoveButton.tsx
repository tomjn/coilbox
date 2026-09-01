import { Button } from "@picoframe/frame";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Scenario } from "@/scenario/model";
import { scenarioAttachment } from "../../missionScenario";
import type { CampaignMission } from "../../model";

/**
 * Confirm before a mission is taken out of a campaign (issue #2192).
 *
 * Removing a mission was the one destructive action on either builder screen
 * that happened on the first click, and it is not a small one: the mission
 * carries a briefing, objectives, unit restrictions and a whole copy of a
 * scenario, and its imported panorama is deleted from disk on the way out.
 *
 * So the confirmation says what this particular mission holds rather than
 * asking "are you sure?". The attached scenario is the part worth reading
 * before pressing Delete, because a copy that has fallen behind the builder's
 * document, or whose source scenario is gone, exists nowhere else.
 *
 * A popover, matching the campaign delete on the list page: the row stays on
 * screen behind it, which is what somebody is checking against.
 */
export function MissionRemoveButton({
  mission,
  scenarios,
  onRemove,
}: {
  mission: CampaignMission;
  /** Every scenario stored here, to say whether the attached copy is the only one. */
  scenarios: Scenario[];
  /** Drops the mission and deletes its panorama file. Reports its own failures. */
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const losses = missionLosses(mission, scenarios);

  // The page owns the error banner for a failed save, so there is nothing to
  // report in here: by the time this resolves the popover has no reason to stay.
  const remove = async () => {
    setBusy(true);
    await onRemove();
    setBusy(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Remove ${mission.title}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="break-words text-sm font-medium">
            Remove {mission.title}?
          </h3>
          {losses.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                This can't be undone. It takes with it:
              </p>
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {losses.map((loss) => (
                  <li key={loss} className="break-words">
                    {loss}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This can't be undone, though nothing has been written on this
              mission yet beyond its place in the campaign.
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
            variant="destructive"
            className="gap-1.5"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 className="size-4" /> {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** English for a count of something, so "1 objective" is not "1 objectives". */
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * What this mission holds that removing it destroys, as sentence fragments.
 *
 * Only what the mission actually has: an empty briefing is not worth a warning,
 * and a list of things somebody never filled in reads as boilerplate, which is
 * how a confirmation stops being read at all.
 */
export function missionLosses(
  mission: CampaignMission,
  scenarios: Scenario[],
): string[] {
  const losses: string[] = [];
  if (mission.briefing.trim() !== "") losses.push("its briefing");
  if (mission.objectives.length > 0) {
    losses.push(plural(mission.objectives.length, "objective", "objectives"));
  }
  if (mission.disabledUnits.length > 0) {
    losses.push(
      plural(
        mission.disabledUnits.length,
        "unit restriction",
        "unit restrictions",
      ),
    );
  }
  // Only an imported file is deleted from disk. A bundled or inlined panorama
  // is a reference the mission loses, and the image survives it.
  if (mission.panorama?.kind === "file") {
    losses.push("its panorama image, deleted from disk");
  }
  const attached = scenarioAttachment(mission, scenarios);
  switch (attached.state) {
    case "current":
      losses.push(
        `its copy of the scenario "${attached.snapshot.name}", which stays in the scenario builder`,
      );
      break;
    case "stale":
      losses.push(
        `its copy of the scenario "${attached.snapshot.name}", which is not the one the scenario builder now holds`,
      );
      break;
    case "orphaned":
      losses.push(
        `the only copy of the scenario "${attached.snapshot.name}", which is no longer in the scenario builder`,
      );
      break;
  }
  return losses;
}

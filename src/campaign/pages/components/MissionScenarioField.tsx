import { Button } from "@picoframe/frame";
import { Flag, Link2Off, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { scenarioContents } from "@/scenario/listing";
import type { Scenario } from "@/scenario/model";
import { useScenarios } from "@/scenario/scenarios";
import {
  attachScenario,
  detachScenario,
  scenarioAttachment,
} from "../../missionScenario";
import type { CampaignMission } from "../../model";
import { ScenarioPickerList } from "./ScenarioPicker";

/** An edit timestamp in the reader's own locale, or nothing when unstamped. */
function editedAt(iso: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The mission's scenario: what is attached, whether the copy has fallen behind
 * the scenario it came from, and the controls to attach, update or detach.
 *
 * Attaching copies the whole document in, so the mission goes on playing what
 * its author attached however the source is edited afterwards. That is the point
 * of the snapshot, and also the thing an author can be caught out by, so the
 * comparison against the stored scenario is shown here rather than left to be
 * discovered in-game.
 *
 * The picker is a popover rather than a drawer because this sits inside the
 * mission editor's own drawer, and the app has one drawer.
 */
export function MissionScenarioField({
  mission,
  onChange,
}: {
  mission: CampaignMission;
  onChange: (mission: CampaignMission) => void;
}) {
  const { scenarios: loaded, loading } = useScenarios();
  const scenarios = loaded.map((l) => l.scenario);
  const [open, setOpen] = useState(false);
  const attachment = scenarioAttachment(mission, scenarios);

  const pick = (scenario: Scenario) => {
    setOpen(false);
    onChange(attachScenario(mission, scenario));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Scenario</span>
      <p className="text-xs text-muted-foreground">
        What the mission runtime plays once the engine is up: spawns, zones,
        triggers, objectives and dialogue. Attaching copies the scenario into
        this mission and sets the mission&apos;s game and map from it. A mission
        with no scenario plays as an ordinary skirmish.
      </p>

      {attachment.state === "none" ? (
        <p className="text-xs text-muted-foreground/80">
          No scenario attached.
        </p>
      ) : (
        <div className="flex flex-col gap-1 rounded-md border border-border/50 bg-muted/20 p-3">
          <span className="truncate text-sm font-medium">
            {attachment.snapshot.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {scenarioContents(attachment.snapshot)}
          </span>
          {attachment.state === "stale" ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              This mission plays the copy attached from the version of{" "}
              {editedAt(attachment.snapshot.updatedAt) || "an earlier edit"}.
              The stored scenario has been edited since, on{" "}
              {editedAt(attachment.live.updatedAt) || "a later date"}.
            </p>
          ) : attachment.state === "orphaned" ? (
            <p className="text-xs text-muted-foreground/80">
              No stored scenario has this id any more, so there is nothing to
              compare against. The mission plays its own copy.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/80">
              Matches the stored scenario.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Flag className="size-4" />{" "}
              {attachment.state === "none"
                ? "Attach scenario"
                : "Change scenario"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 p-3">
            {loading ? (
              <p className="text-xs text-muted-foreground">
                Reading your scenarios…
              </p>
            ) : (
              <ScenarioPickerList scenarios={scenarios} onPick={pick} />
            )}
          </PopoverContent>
        </Popover>

        {attachment.state === "stale" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => onChange(attachScenario(mission, attachment.live))}
          >
            <RefreshCw className="size-4" /> Update to latest
          </Button>
        )}

        {attachment.state !== "none" && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => onChange(detachScenario(mission))}
          >
            <Link2Off className="size-4" /> Detach
          </Button>
        )}
      </div>
    </div>
  );
}

import { Button, Drawer } from "@picoframe/frame";
import { FileCode2, Flag, Link2Off } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { scenarioContents } from "@/scenario/listing";
import type { Scenario } from "@/scenario/model";
import { MissionLuaView } from "@/scenario/pages/components/MissionLuaView";
import { useScenarios } from "@/scenario/scenarios";
import {
  attachScenario,
  detachScenario,
  scenarioAttachment,
} from "../../missionScenario";
import type { CampaignMission } from "../../model";
import {
  editedAt,
  MissionScenarioUpdateButton,
} from "./MissionScenarioUpdateButton";
import { ScenarioPickerList } from "./ScenarioPicker";

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
 *
 * No heading of its own. The drawer's Scenario group is the heading now (issue
 * #2261), and two of them a size apart saying the same word read as two
 * different things.
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
  const [showLua, setShowLua] = useState(false);
  const attachment = scenarioAttachment(mission, scenarios);
  // The attached copy, never the stored scenario it came from. A stale
  // attachment is the case somebody opens this in: the mission plays the
  // snapshot, and showing them the document in the builder instead would answer
  // a question they did not ask (issue #2163).
  const snapshot =
    attachment.state === "none" ? undefined : attachment.snapshot;

  const pick = (scenario: Scenario) => {
    setOpen(false);
    onChange(attachScenario(mission, scenario));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        What the mission runtime plays once the engine is up: spawns, zones,
        triggers, objectives and dialogue. Attaching copies the scenario into
        this mission and sets the mission&apos;s game and map from it. A mission
        with no scenario plays as an ordinary skirmish.
      </p>

      {attachment.state === "none" ? (
        <p className="text-xs text-muted-foreground">No scenario attached.</p>
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
            <p className="text-xs text-muted-foreground">
              No stored scenario has this id any more, so there is nothing to
              compare against. The mission plays its own copy.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
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
          <MissionScenarioUpdateButton
            mission={mission}
            attachment={attachment}
            onUpdate={onChange}
          />
        )}

        {snapshot && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setShowLua(true)}
          >
            <FileCode2 className="size-4" /> Mission Lua
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

      {/* Its own controlled drawer rather than the frame's shared one, which
        the mission editor around this is already using. */}
      {snapshot && (
        <Drawer
          open={showLua}
          onOpenChange={setShowLua}
          title={`${snapshot.name} as mission.lua`}
          width="44rem"
        >
          <MissionLuaView scenario={snapshot} />
        </Drawer>
      )}
    </div>
  );
}

import { t as coreT, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Scenario } from "@/scenario/model";
import { getLocale } from "../../../i18n";
import { missionMedia } from "../../media";
import { scenarioAttachment } from "../../missionScenario";
import type { CampaignMission } from "../../model";

/**
 * Confirm before a mission is taken out of a campaign (issue #2192).
 *
 * Removing a mission was the one destructive action on either builder screen
 * that happened on the first click, and it is not a small one: the mission
 * carries a briefing, objectives, unit restrictions and a whole copy of a
 * scenario, and everything it imported goes off disk on the way out.
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
  others,
  scenarios,
  onRemove,
}: {
  mission: CampaignMission;
  /** The campaign's other missions, to say which of this one's files another
   *  mission also plays and so which of them actually go off disk. */
  others: CampaignMission[];
  /** Every scenario stored here, to say whether the attached copy is the only one. */
  scenarios: Scenario[];
  /** Drops the mission and deletes its imported files. Reports its own failures. */
  onRemove: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = mission.title;
  const losses = missionLosses(mission, scenarios, others);

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
          aria-label={t`Remove ${title}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="break-words text-sm font-medium">
            <Trans>Remove {title}?</Trans>
          </h3>
          {losses.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                <Trans>This can't be undone. It takes with it:</Trans>
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
              <Trans>
                This can't be undone, though nothing has been written on this
                mission yet beyond its place in the campaign.
              </Trans>
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
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="gap-1.5"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 className="size-4" /> {busy ? t`Removing…` : t`Remove`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "a", "a and b", "a, b and c", joined the way the app language joins them. */
const asList = (items: string[]) =>
  new Intl.ListFormat(getLocale() === "en" ? "en-GB" : getLocale(), {
    type: "conjunction",
    style: "long",
  }).format(items);

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
  others: CampaignMission[] = [],
): string[] {
  const losses: string[] = [];
  if (mission.briefing.trim() !== "") losses.push(coreT`its briefing`);
  const objectiveCount = mission.objectives.length;
  const restrictionCount = mission.disabledUnits.length;
  if (objectiveCount > 0) {
    losses.push(
      plural(objectiveCount, {
        one: "# objective",
        other: "# objectives",
      }),
    );
  }
  if (restrictionCount > 0) {
    losses.push(
      plural(restrictionCount, {
        one: "# unit restriction",
        other: "# unit restrictions",
      }),
    );
  }
  // Only an imported file is deleted from disk. A bundled or inlined panorama
  // is a reference the mission loses, and the image survives it. Read from the
  // same slot list the delete works through, so the promise and the deletion
  // cannot drift apart (issue #2210).
  //
  // And only a file nothing else names. The delete has always kept a file
  // another mission still plays, but the wording said it went, which duplicating
  // a mission makes the common case rather than the odd one: the copy shares the
  // original's art (issue #2196). So the two are said apart.
  const shared = new Set(
    others.flatMap((m) => missionMedia(m).map((x) => x.file)),
  );
  const imported = missionMedia(mission);
  const deleted = imported
    .filter((m) => !shared.has(m.file))
    .map((m) => m.label);
  const kept = imported.filter((m) => shared.has(m.file)).map((m) => m.label);
  if (deleted.length > 0) {
    const list = asList(deleted);
    losses.push(coreT`its ${list}, deleted from disk`);
  }
  if (kept.length > 0) {
    const list = asList(kept);
    const keptCount = kept.length;
    losses.push(
      plural(keptCount, {
        one: `its ${list}, kept on disk because another mission uses the same file`,
        other: `its ${list}, kept on disk because another mission uses the same files`,
      }),
    );
  }
  const attached = scenarioAttachment(mission, scenarios);
  const scenarioName = attached.state === "none" ? "" : attached.snapshot.name;
  switch (attached.state) {
    case "current":
      losses.push(
        coreT`its copy of the scenario "${scenarioName}", which stays in the scenario builder`,
      );
      break;
    case "stale":
      losses.push(
        coreT`its copy of the scenario "${scenarioName}", which is not the one the scenario builder now holds`,
      );
      break;
    case "orphaned": {
      // "The only copy" stops being true the moment a mission carrying it is
      // duplicated, and the copy is a whole second scenario document rather
      // than a shared file, so this one is checked the same way the media is.
      const elsewhere = others.some(
        (m) => m.scenario?.id === attached.snapshot.id,
      );
      losses.push(
        elsewhere
          ? coreT`its copy of the scenario "${scenarioName}", which is no longer in the scenario builder but which another mission also carries`
          : coreT`the only copy of the scenario "${scenarioName}", which is no longer in the scenario builder`,
      );
      break;
    }
  }
  return losses;
}

/**
 * Everything wrong with the mission being written, in two lists: what stops it
 * playing, and what plays and reads to a player as a bug (issue #2162).
 *
 * The wording is `describeIssue`'s, which is what the test drawer shows after a
 * refused launch. An author who has read one of these sentences in the header
 * has read the sentence Test would have given them.
 *
 * The document is here so each sentence can lead with the author's own name for
 * the thing it is about rather than with the id in the compiled file (issue
 * #2249). The list is the whole point: an author reading it is looking for the
 * row to click, and issue #2271 is that click: a row `problemTarget` can place
 * is a button that hands the issue back to `onActivate`, and one it cannot is
 * left as plain text, so the two kinds of row read and sound different rather
 * than a click that silently does nothing.
 */

import { Button } from "@picoframe/frame";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import type { Scenario } from "../../model";
import {
  describeIssue,
  type IssueLabels,
  type MissionIssue,
  missionIssueLabels,
} from "../../validate";
import {
  missionProblemsLookWrong,
  missionProblemsStopPlay,
} from "../../wording";
import { problemTarget } from "./problemTargets";
import type { MissionProblems } from "./useMissionProblems";

function IssueList({
  issues,
  labels,
  onActivate,
}: {
  issues: MissionIssue[];
  labels: IssueLabels;
  onActivate: (issue: MissionIssue) => void;
}) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4">
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>
          {problemTarget(issue.path) ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between gap-2 whitespace-normal px-2 py-1 text-left text-xs font-normal"
              onClick={() => onActivate(issue)}
            >
              {describeIssue(issue, labels)}
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Button>
          ) : (
            describeIssue(issue, labels)
          )}
        </li>
      ))}
    </ul>
  );
}

export function MissionProblemsList({
  problems,
  scenario,
  onActivate,
}: {
  problems: MissionProblems;
  scenario: Scenario;
  /** Where an issue's row points, when it has somewhere to point: the trigger,
   *  objective, zone or variable panel that owns it, or the thing on the map
   *  itself (issue #2271). Called only for a row `problemTarget` gave a target
   *  to, so this never has to decide what "no target" means on its own. */
  onActivate: (issue: MissionIssue) => void;
}) {
  const { blocking, warnings } = problems;
  const labels = useMemo(() => missionIssueLabels(scenario), [scenario]);
  return (
    <div className="flex flex-col gap-5 text-xs">
      {blocking.length > 0 ? (
        <section className="flex flex-col gap-2 text-destructive">
          <p className="flex items-center gap-2 text-sm">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {missionProblemsStopPlay(blocking.length)}
          </p>
          <IssueList
            issues={blocking}
            labels={labels}
            onActivate={onActivate}
          />
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="flex flex-col gap-2 text-amber-300">
          <p className="text-sm">{missionProblemsLookWrong(warnings.length)}</p>
          <IssueList
            issues={warnings}
            labels={labels}
            onActivate={onActivate}
          />
        </section>
      ) : null}

      {/* The list is live, so an author can fix the last thing in it with this
          open and watch it empty. */}
      {blocking.length === 0 && warnings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every reference in this mission resolves, and there is nothing in it a
          player would read as a bug.
        </p>
      ) : null}
    </div>
  );
}

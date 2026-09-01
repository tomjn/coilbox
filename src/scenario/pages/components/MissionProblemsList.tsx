/**
 * Everything wrong with the mission being written, in two lists: what stops it
 * playing, and what plays and reads to a player as a bug (issue #2162).
 *
 * The wording is `describeIssue`'s, which is what the test drawer shows after a
 * refused launch. An author who has read one of these sentences in the header
 * has read the sentence Test would have given them.
 */

import { TriangleAlert } from "lucide-react";
import { describeIssue, type MissionIssue } from "../../validate";
import {
  missionProblemsLookWrong,
  missionProblemsStopPlay,
} from "../../wording";
import type { MissionProblems } from "./useMissionProblems";

function IssueList({ issues }: { issues: MissionIssue[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4">
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>{describeIssue(issue)}</li>
      ))}
    </ul>
  );
}

export function MissionProblemsList({
  problems,
}: {
  problems: MissionProblems;
}) {
  const { blocking, warnings } = problems;
  return (
    <div className="flex flex-col gap-5 text-xs">
      {blocking.length > 0 ? (
        <section className="flex flex-col gap-2 text-destructive">
          <p className="flex items-center gap-2 text-sm">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {missionProblemsStopPlay(blocking.length)}
          </p>
          <IssueList issues={blocking} />
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="flex flex-col gap-2 text-amber-300">
          <p className="text-sm">{missionProblemsLookWrong(warnings.length)}</p>
          <IssueList issues={warnings} />
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

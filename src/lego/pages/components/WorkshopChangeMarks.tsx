/**
 * A mark beside a number the builder shows, for each workshop project that
 * changes it and has not written the change into the unit's file (issue #4243).
 * The mark opens that field on the workshop's unit page.
 */
import { useMemo } from "react";
import { Link } from "react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { luaLiteral } from "@/lib/lua";
import { useModProjects } from "@/workshop/project";
import { projectPath } from "@/workshop/routes";
import { type WorkshopChange, workshopChanges } from "../../builderFields";
import type { LegoProject } from "../../model";
import { useBuiltUnitDef } from "./useBuiltUnitDef";

function shown(value: unknown): string {
  return typeof value === "string"
    ? value
    : luaLiteral(value).replace(/\s*\n\s*/g, " ");
}

/**
 * The workshop changes to a built unit that its file does not hold yet, for the
 * fields at `paths`. Empty for a unit that was never exported, and until the
 * game's read has come back with the unit's file.
 */
export function useWorkshopChanges(project: LegoProject) {
  const { projects } = useModProjects();
  const { game, key, def } = useBuiltUnitDef(project);
  return useMemo(
    () => ({
      key,
      changesFor: (paths: readonly string[]): WorkshopChange[] =>
        game && key
          ? workshopChanges(projects, game.name, key, def, paths)
          : [],
    }),
    [projects, game, key, def],
  );
}

export function WorkshopChangeMarks({
  unitKey,
  changes,
}: {
  unitKey: string | null;
  changes: WorkshopChange[];
}) {
  if (!unitKey || changes.length === 0) return null;
  return (
    <>
      {changes.map((change) => {
        const sentence = `Changed to ${shown(change.value)} in the workshop project ${change.projectName}, ${
          change.mutatorOnly
            ? "sent through the mutator, so it is not written into the game"
            : "not written into the game yet"
        }.`;
        return (
          <TooltipProvider
            key={`${change.projectId}:${change.path}`}
            delayDuration={150}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to={projectPath(change.projectId, unitKey, change.path)}
                  aria-label={sentence}
                  className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                >
                  {shown(change.value)} in {change.projectName}
                </Link>
              </TooltipTrigger>
              <TooltipContent className="text-left leading-snug">
                {sentence}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </>
  );
}

/** The marks for the fields at `paths`, for a place that has only the project. */
export function ProjectWorkshopMarks({
  project,
  paths,
}: {
  project: LegoProject;
  paths: readonly string[];
}) {
  const { key, changesFor } = useWorkshopChanges(project);
  return <WorkshopChangeMarks unitKey={key} changes={changesFor(paths)} />;
}

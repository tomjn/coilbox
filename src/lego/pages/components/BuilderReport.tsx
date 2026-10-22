/**
 * What kind of builder the unit is and what it builds (issue #3291).
 *
 * The kind comes from `builderKind`. The build list is read from the unit's file
 * in the game it was exported into, since the workshop owns `buildoptions` and
 * writes it there (issue #3313), so this only shows it and links to where to
 * change it.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import { buildOptionsOf } from "../../../workshop/buildMenus";
import { useModProjects } from "../../../workshop/project";
import { unitEditPath } from "../../../workshop/routes";
import { builderKind, buildsLine } from "../../buildArm";
import type { LegoProject } from "../../model";
import { useBuiltUnitDef } from "./useBuiltUnitDef";

export function BuilderReport({ project }: { project: LegoProject }) {
  const { t } = useLingui();
  const { projects } = useModProjects();
  const { game, key, def } = useBuiltUnitDef(project);

  const answer = builderKind(project, def);
  if (!answer) return null;
  const options = buildOptionsOf(def);
  const reason = answer.reason;
  const kindLine =
    answer.kind === "mobile"
      ? t`Mobile builder, because ${reason}.`
      : answer.kind === "static"
        ? t`Static builder, because ${reason}.`
        : t`Factory, because ${reason}.`;

  return (
    <div className="mt-2 flex flex-col gap-0.5 text-xs">
      <p>{kindLine}</p>
      <p>
        <span className="text-muted-foreground">{buildsLine(options)}</span>
        {game && key ? (
          <>
            {" "}
            <Link
              className="underline"
              to={unitEditPath(projects, game.name, key)}
            >
              {options.length === 0 ? (
                <Trans>Set it in Unit tweaks</Trans>
              ) : (
                <Trans>Change in Unit tweaks</Trans>
              )}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

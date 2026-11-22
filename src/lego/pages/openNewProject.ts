import type { NavigateFunction } from "react-router";
import type { RoleFindings } from "../inferRoles";
import type { LegoProject } from "../model";
import { saveProject } from "../projects";

/**
 * Save a unit made somewhere other than New model and open it in the builder.
 *
 * A project rebuilt from an export, a model imported whole, or a generated
 * candidate. All arrive as an ordinary document, and an imported one already
 * has its geometry and its textures on disk. `proposeFrom` is the roles its
 * script proposed, when it opens with a skeleton proposed from them. Rejects
 * when the save fails, so the page can say so.
 */
export async function openNewProject(
  project: LegoProject,
  navigate: NavigateFunction,
  proposeFrom?: RoleFindings,
): Promise<void> {
  await saveProject(project);
  if (proposeFrom) {
    navigate(`/lego/${project.id}`, {
      state: { proposeSkeleton: proposeFrom },
    });
  } else {
    navigate(`/lego/${project.id}`);
  }
}

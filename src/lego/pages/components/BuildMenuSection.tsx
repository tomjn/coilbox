/**
 * The family view's way onto a build menu (issue #3288): pick one of the game's
 * builders and add the exported loadouts to its menu, or take them off again.
 *
 * What it writes is the workshop editor's own `add` operation, in the game's
 * newest workshop project, so the workshop shows it. A game with no project
 * gets one, named and made the way the workshop's unit page makes the first one.
 * A game maker's tool: nothing here is offered to a player.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useMemo, useState } from "react";

import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { gameIdentityForName } from "../../../container/gameIdentity";
import { applyBuildMenu, buildOptionsOf } from "../../../workshop/buildMenus";
import {
  defaultProjectName,
  EMPTY_EDITS,
  type GameEdits,
  useModProjects,
} from "../../../workshop/project";
import {
  buildersOf,
  projectForGame,
  variantsOf,
  withVariantsAdded,
  withVariantsRemoved,
} from "../../buildMenuVariants";
import type { LegoProject } from "../../model";
import { useBuildMenuSource } from "./useBuildMenuSource";

export function BuildMenuSection({ project }: { project: LegoProject }) {
  const { t } = useLingui();
  const source = useBuildMenuSource(project);
  const { projects, createProject, applyEdits } = useModProjects();
  const [chosen, setChosen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const builders = useMemo(
    () => (source.units ? buildersOf(source.units) : []),
    [source.units],
  );
  const builder =
    builders.find((b) => b.key === chosen)?.key ?? builders[0]?.key ?? null;
  const variants = source.gameFolder
    ? variantsOf(project, source.gameFolder)
    : [];
  const target = source.gameName
    ? projectForGame(projects, source.gameName)
    : undefined;

  const inherited = buildOptionsOf(
    builder
      ? (source.units?.[builder] as Record<string, unknown> | undefined)
      : undefined,
  );
  const onMenu = new Set(
    builder
      ? applyBuildMenu(inherited, target?.edits.menus?.[builder] ?? [])
      : [],
  );
  const offered = variants.filter((v) => v.unit !== null);
  const selected = offered.filter((v) => picked.includes(v.id));
  const toAdd = selected.flatMap((v) =>
    v.unit && !onMenu.has(v.unit) ? [v.unit] : [],
  );
  const toRemove = selected.flatMap((v) =>
    v.unit && onMenu.has(v.unit) ? [v.unit] : [],
  );

  function commit(update: (edits: GameEdits) => GameEdits) {
    const gameName = source.gameName;
    if (!gameName) return;
    if (target) {
      applyEdits(target.id, update);
      return;
    }
    const edits = update(EMPTY_EDITS);
    if (edits === EMPTY_EDITS) return;
    createProject({
      name: defaultProjectName(gameName, projects),
      gameName,
      game: gameIdentityForName(gameName, source.installed) ?? undefined,
      authoredChecksum: source.checksum,
      edits,
    });
  }

  const targetName = target?.name ?? "";
  const nextProjectName = defaultProjectName(source.gameName ?? "", projects);

  const toggle = (id: string, on: boolean) =>
    setPicked((now) => (on ? [...now, id] : now.filter((x) => x !== id)));

  return (
    <section
      aria-label={t`Build menu`}
      className="flex shrink-0 flex-col gap-2 -mx-5 border-t border-border/60 px-5 pt-3"
    >
      <h3 className="text-sm font-semibold">
        <Trans>Build menu</Trans>
      </h3>
      {source.unavailable ? (
        <p className="text-xs text-muted-foreground">{source.unavailable}</p>
      ) : !builder ? (
        <p className="text-xs text-muted-foreground">
          {source.units ? (
            <Trans>The game has no builders.</Trans>
          ) : (
            <Trans>Reading the game.</Trans>
          )}
        </p>
      ) : (
        <>
          <OptionSelect
            size="sm"
            value={builder}
            onValueChange={setChosen}
            options={builders.map((b) => ({
              value: b.key,
              label: b.name === b.key ? b.key : `${b.name} (${b.key})`,
            }))}
            ariaLabel={t`Builder`}
          />
          <ul className="flex flex-col gap-1">
            {variants.map((v) => (
              <li key={v.id} className="flex items-center gap-2 text-xs">
                {v.unit ? (
                  <>
                    <Checkbox
                      id={`lego-menu-${v.id}`}
                      checked={picked.includes(v.id)}
                      onCheckedChange={(on) => toggle(v.id, on === true)}
                    />
                    <Label htmlFor={`lego-menu-${v.id}`}>{v.name}</Label>
                    <span className="text-muted-foreground">
                      {onMenu.has(v.unit) ? t`On the menu` : v.unit}
                    </span>
                  </>
                ) : (
                  <>
                    <span>{v.name}</span>
                    <span className="text-muted-foreground">
                      <Trans>Export it first.</Trans>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offered.length === 0}
              onClick={() => setPicked(offered.map((v) => v.id))}
            >
              <Trans>Select all</Trans>
            </Button>
            <Button
              size="sm"
              disabled={toAdd.length === 0}
              onClick={() =>
                commit((edits) =>
                  withVariantsAdded(edits, builder, toAdd, inherited),
                )
              }
            >
              <Trans>Add</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={toRemove.length === 0}
              onClick={() =>
                commit((edits) =>
                  withVariantsRemoved(edits, builder, toRemove, inherited),
                )
              }
            >
              <Trans>Remove</Trans>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {target
              ? t`Saved in ${targetName}.`
              : t`Starts ${nextProjectName}.`}
          </p>
        </>
      )}
    </section>
  );
}

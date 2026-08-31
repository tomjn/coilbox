import { ArrowDown, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
  useUnitsyncUnitModel,
} from "../config";
import { groupOf, morphGroups } from "../morphGraph";
import { encyclopediaSections, unitLabel } from "../unitEncyclopedia";
import { unitIconSrc } from "../unitIcon";
import { countPieces, countTriangles } from "../unitModel";
import { StatusBadge } from "./components/StatusBadge";
import { DetailError, DetailLoading, NotFound } from "./components/states";
import { UnitHero } from "./components/UnitHero";
import { UnitPictureCard } from "./components/UnitPictureCard";
import { UnitRendersRow } from "./components/UnitRendersRow";
import { UnitStatsTable } from "./components/UnitStatsTable";
import { useUnitRenders } from "./components/useUnitRenders";

/**
 * One unit's own page: its model first, full width, then its four rendered
 * angles, then its identity (buildpic, name, def key and faction), then its
 * stats, build relationships, morph stages and terrain limits. `UnitHero` and
 * `useUnitRenders` both key off `object`/`model`, read once here and handed
 * down, rather than each reading the model a second time. Reads the same
 * scan/game-info/unit-dataset hooks `GameUnitsPage` reads, so the dataset
 * this page's unit is found in is the one already cached by the grid a
 * reader came from.
 */
export default function GameUnitPage() {
  const { name, unit: unitParam } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const id = unitParam ? decodeURIComponent(unitParam).toLowerCase() : "";

  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const game = data?.games.find((g) => g.name === decoded);
  const { info: gameInfo, loading: gameInfoLoading } = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const { dataset, status: datasetStatus } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  const unit = dataset?.units.find((u) => u.name.toLowerCase() === id);

  // Keyed lowercase on both sides, matching every other id lookup on this
  // page: a def key is only ever compared case-insensitively.
  const byId = new Map(
    (dataset?.units ?? []).map((u) => [u.name.toLowerCase(), u]),
  );

  // What this unit builds: its own `buildOptions`, resolved against the
  // dataset so a stripped or unrecognised target is silently dropped rather
  // than linking somewhere.
  const builds = [
    ...new Set((unit?.buildOptions ?? []).map((t) => t.toLowerCase())),
  ].filter((t) => byId.has(t));

  // What builds this unit: the reverse of `buildOptions`, built once as a
  // single map over every unit rather than filtering the whole dataset again
  // for each render. Each target's builders are a `Set`, not an array: a
  // builder whose own `buildOptions` names the same target twice would
  // otherwise list itself twice under one duplicate React key.
  const builtByMap = new Map<string, Set<string>>();
  for (const u of dataset?.units ?? []) {
    for (const target of u.buildOptions ?? []) {
      const key = target.toLowerCase();
      const builders = builtByMap.get(key);
      if (builders) builders.add(u.name.toLowerCase());
      else builtByMap.set(key, new Set([u.name.toLowerCase()]));
    }
  }
  const builtBy = [...(builtByMap.get(id) ?? [])];

  // This unit's whole morph group: every stage from the ladder's bottom rung
  // to its top, in the order `morphGroups` (`morphGraph.ts`, vendored byte
  // identical into the hub, so it is read here rather than reimplemented)
  // already gives them. A unit with no morph edge at all is in no group, so
  // `stageChain` comes back empty and the section built from it stays
  // hidden rather than showing a chain of one.
  const morphGroupList = morphGroups(dataset?.units ?? []);
  const morphBase = groupOf(morphGroupList).get(id);
  const stageChain =
    morphGroupList.find((g) => g.base === morphBase)?.stages ?? [];

  // Computed unconditionally, ahead of every early return below, so
  // `useUnitsyncUnitBuildpics` is called on every render in the same order,
  // the same reasoning `GameUnitsPage` documents for its own call.
  //
  // Fetches with `id` (the lowercased route param), not `unit.name` (the
  // dataset's original-case string): the worker keys its result map with
  // exactly the string it was handed, and the read below looks it up by
  // `id`. A game whose def key isn't already all lowercase would fetch under
  // one key and read under another, matching nothing. `GameUnitsPage` avoids
  // this the same way, fetching and reading with its already-lowercased
  // `cell.id` throughout.
  //
  // One call for every picture this page can show, not one per section: this
  // unit itself, what it builds, what builds it, and every morph stage. That
  // is also why this reads `builds`/`builtBy`/`stageChain` computed above
  // rather than after the gates below: they all have to exist before this
  // call, not just before the JSX that draws them.
  const buildpicIds = unit
    ? [...new Set([id, ...builds, ...builtBy, ...stageChain])]
    : [];
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    buildpicIds,
  );

  // Same object the hero draws, called here rather than inside `UnitHero` so
  // the render row below can draw from the one model already in memory
  // instead of reading it a second time.
  const object = unit?.objectName?.trim();
  const {
    model,
    loading: modelLoading,
    failed: modelFailed,
  } = useUnitsyncUnitModel(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    object,
  );

  // The render cache is keyed on the game's modinfo shortname, never its
  // archive name (see `useUnitRenders`), and a game need not declare one.
  const gameShortname = game?.info.shortname?.trim() || undefined;
  const renders = useUnitRenders(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    gameShortname,
    unit ? id : undefined,
    object,
    unit?.footprintX ?? 1,
    unit?.footprintZ ?? 1,
    model,
  );

  if (error && !data)
    return (
      <DetailError
        backTo="/content/games"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/games" />;
  if (!game) return <NotFound backTo="/content/games" label="game" />;

  const unitsBackTo = `/content/games/${encodeURIComponent(game.name)}/units`;

  if (datasetStatus === "error")
    return (
      <div className="flex flex-col gap-3 p-4">
        <Link
          to={unitsBackTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          {game.name} units
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Could not read this game&apos;s units</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1 font-mono text-xs">
              {(dataset?.errors ?? []).map((e) => (
                <li key={e} className="break-words">
                  {e}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      </div>
    );

  // Same gate `GameUnitsPage` uses, and for the same reason. The dataset is
  // the slow read, `"idle"`/`"loading"` both still block, and `"unsyncable"`
  // falls through since its `dataset.units` is already populated.
  if (
    datasetStatus === "idle" ||
    datasetStatus === "loading" ||
    gameInfoLoading ||
    !gameInfo ||
    !selected
  )
    return <DetailLoading backTo={unitsBackTo} />;

  if (!unit)
    return (
      <div className="flex flex-col gap-4 p-4">
        <Link
          to={unitsBackTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            That unit is not in this game.
          </p>
        </div>
      </div>
    );

  // Which faction's tech forest reaches this unit, reusing the grid's own
  // grouping rather than a second walk of the build graph. A match on the
  // unit's own id or on one of its folded morph stages, the same as a search
  // hit in the grid.
  const roots = (gameInfo.sides ?? []).flatMap((s) =>
    s.startUnit ? [{ id: s.startUnit, label: s.name }] : [],
  );
  const sections = encyclopediaSections(dataset?.units ?? [], roots, "");
  const factionSection = sections.find((s) =>
    s.cells.some((c) => c.id === id || c.stages.includes(id)),
  );
  // `factionGroups` (techForest.ts) always labels the block nothing reaches
  // "Other units" under the empty id, for the units no side's tech forest
  // touches. That block is not a faction, so a unit landing in it (or every
  // unit, on a game whose sides could not be read) should say nothing here
  // rather than claim "Other units" as its faction.
  const faction =
    factionSection && factionSection.id !== ""
      ? factionSection.label
      : undefined;

  const display = buildpics?.units[id];
  const src = unitIconSrc(display);

  const label = (targetId: string) => unitLabel(byId.get(targetId), targetId);
  const unitPath = (targetId: string) =>
    `/content/games/${encodeURIComponent(game.name)}/units/${encodeURIComponent(targetId)}`;

  // The game's own data for one hop of the morph chain: whichever of
  // `fromId`'s declared morph targets names `toId`, with every key but
  // `into` kept exactly as the game wrote it. This is free-form JSON keyed
  // however a game likes (`cmdname`, `energy`, `research`, ...), so nothing
  // here assumes a fixed set of keys.
  const edgeConditions = (fromId: string, toId: string) =>
    (byId.get(fromId)?.morphTargets ?? [])
      .filter((m) => m.into?.toLowerCase() === toId)
      .flatMap((m) => Object.entries(m).filter(([key]) => key !== "into"));

  // "Where it can be built" is a section about static placement, so it is
  // gated on `mobile === false` rather than on whether any of its fields are
  // present.
  // `footprintX`, `footprintZ` and `floatOnWater` are never optional on the
  // wire (model.rs's `UnitDatasetEntry` declares them as plain `u32`/`bool`,
  // not `Option`), so a presence check here was always true and every mobile
  // unit's page carried a section reporting whether it floats. `mobile` is
  // the field the worker itself derives to mean exactly "static building vs
  // mobile unit" (model.rs:541-543), so it stands in for that question
  // directly. The one thing this misses: a mobile unit the game still
  // declares a slope or water limit for (a hovercraft, say) would lose this
  // section too, since nothing here distinguishes that case from an ordinary
  // mobile unit.
  const isStationary = unit.mobile === false;

  // The engine's own "no limit" sentinels (bindings.ts documents them:
  // -10e6/+10e6, a band wide enough to refuse nothing), not just an absent
  // field. On a cached Metal Factions roster, 294 of 716 units carrying
  // these fields have both bounds sitting exactly on the sentinel, and
  // printing that as "Water depth -10000000 to 10000000 elmos" would read as
  // a real limit when the def declared none.
  const NO_MIN_WATER_DEPTH = -10e6;
  const NO_MAX_WATER_DEPTH = 10e6;
  const hasMinWaterLimit =
    unit.minWaterDepth !== undefined && unit.minWaterDepth > NO_MIN_WATER_DEPTH;
  const hasMaxWaterLimit =
    unit.maxWaterDepth !== undefined && unit.maxWaterDepth < NO_MAX_WATER_DEPTH;
  const hasWaterLimit = hasMinWaterLimit || hasMaxWaterLimit;

  // "elmos" is the engine's own unit of length, meaningless to a player. A
  // bound the def leaves at the sentinel says nothing, so it is dropped
  // rather than spelled out as "any": a unit declaring only a maximum reads
  // as "600 deep", not "any to 600 elmos".
  const waterDepthText =
    hasMinWaterLimit && hasMaxWaterLimit
      ? `${unit.minWaterDepth} to ${unit.maxWaterDepth} deep`
      : hasMaxWaterLimit
        ? `${unit.maxWaterDepth} deep`
        : `${unit.minWaterDepth} deep`;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to={unitsBackTo}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>

      <UnitHero
        object={object}
        model={model}
        loading={modelLoading}
        failed={modelFailed}
        gameArchive={game.primaryArchive.name}
      />

      <div className="flex items-center gap-3">
        {src ? (
          <img
            src={src}
            alt=""
            className="size-16 shrink-0 rounded object-contain"
          />
        ) : (
          <span aria-hidden className="size-16 shrink-0 rounded bg-muted" />
        )}
        <div>
          <h1 className="text-xl font-semibold">{unitLabel(unit, id)}</h1>
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
          {faction && (
            <p className="text-xs text-muted-foreground">{faction}</p>
          )}
        </div>
      </div>

      <UnitRendersRow renders={renders} />

      <UnitStatsTable unit={unit} />

      {builds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">What it builds</h2>
          <ul className="flex flex-wrap gap-3">
            {builds.map((targetId) => (
              <li key={targetId}>
                <UnitPictureCard
                  to={unitPath(targetId)}
                  label={label(targetId)}
                  src={unitIconSrc(buildpics?.units[targetId])}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {builtBy.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">What builds it</h2>
          <ul className="flex flex-wrap gap-3">
            {builtBy.map((builderId) => (
              <li key={builderId}>
                <UnitPictureCard
                  to={unitPath(builderId)}
                  label={label(builderId)}
                  src={unitIconSrc(buildpics?.units[builderId])}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Every stage of the group, not just the next hop: a game can carry
          every tech level of a commander under one shared display name (issue
          #2063's fedcommander_up1..up4 all read "Federation of Kala Command
          Unit"), so a list of one link at a time gave a reader no way to tell
          where they stood. A vertical list keeps the reading order to one
          direction: the wrapping row this replaced put a card, then a wide
          block of condition text, then an arrow, then the next card on
          whichever line it happened to wrap to, with nothing saying a reader
          should follow it top to bottom rather than left to right. Each row's
          own def key, and the current stage rendered as a plain block rather
          than a link, are what make the chain readable when the names
          collide. */}
      {stageChain.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Upgrade path</h2>
          <ol className="flex flex-col gap-1.5">
            {stageChain.map((stageId, i) => {
              const conditions =
                i > 0 ? edgeConditions(stageChain[i - 1], stageId) : [];
              return (
                <li key={stageId} className="flex flex-col gap-1.5">
                  {/* What it costs to reach this stage from the one above it,
                      so the cost sits with the stage it buys rather than
                      trailing the stage it leaves. The top stage has nothing
                      above it, so it carries no cost row. */}
                  {conditions.length > 0 && (
                    <div className="flex items-start gap-2 pl-5 text-xs text-muted-foreground">
                      <ArrowDown className="size-3.5 shrink-0" aria-hidden />
                      <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {conditions.map(([key, value]) => (
                          <div key={key} className="flex gap-1">
                            <dt>{key}:</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  <UpgradeStageRow
                    to={unitPath(stageId)}
                    label={label(stageId)}
                    defKey={stageId}
                    src={unitIconSrc(buildpics?.units[stageId])}
                    current={stageId === id}
                  />
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {isStationary && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Where it can be built</h2>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
            {unit.footprintX !== undefined && unit.footprintZ !== undefined && (
              <div className="contents">
                <dt className="text-muted-foreground">Footprint</dt>
                <dd>
                  {unit.footprintX} by {unit.footprintZ} squares
                </dd>
              </div>
            )}
            {unit.maxSlope !== undefined && (
              <div className="contents">
                <dt className="text-muted-foreground">Maximum slope</dt>
                <dd>{unit.maxSlope}°</dd>
              </div>
            )}
            {unit.floatOnWater !== undefined && (
              <div className="contents">
                <dt className="text-muted-foreground">Floats</dt>
                <dd>{unit.floatOnWater ? "Yes" : "No"}</dd>
              </div>
            )}
            {hasWaterLimit && (
              <div className="contents">
                <dt className="text-muted-foreground">Water depth</dt>
                <dd>{waterDepthText}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* Developer detail rather than player detail (the model's file, format,
          triangle count and textures), so it sits quietly below everything a
          player actually came here for rather than above it. */}
      {model?.root && object && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Model file
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border/50 bg-card px-3 py-2 text-xs">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-all font-mono">{model.path}</dd>

            <dt className="text-muted-foreground">Format</dt>
            <dd>
              {model.format === "3do" ? "3do (Total Annihilation)" : "s3o"}
            </dd>

            <dt className="text-muted-foreground">Size</dt>
            <dd>
              {countTriangles(model.root).toLocaleString()} triangles in{" "}
              {countPieces(model.root).toLocaleString()} pieces
            </dd>

            <dt className="text-muted-foreground">Textures</dt>
            <dd className="break-all font-mono">
              {model.textures.length === 0
                ? "none"
                : model.textures
                    .filter((t) => !t.teamColour)
                    .map((t) => t.name)
                    .join(", ") || "none"}
            </dd>
          </dl>
        </section>
      )}
    </div>
  );
}

/**
 * One row of the upgrade path: a 64px buildpic (matching the grid cell
 * `GameUnitsPage` draws, so a stage looks the same picture wherever a reader
 * meets it), the name wrapping onto a second line rather than eliding it, and
 * the def key in full since that is the one thing on this row that still
 * tells two identically-named stages apart. `current` swaps the link for a
 * plain block, the same rule `UnitPictureCard` follows for the same reason:
 * the stage a reader is already on must never link to itself.
 */
function UpgradeStageRow({
  to,
  label,
  defKey,
  src,
  current,
}: {
  to: string;
  label: string;
  defKey: string;
  src?: string;
  current: boolean;
}) {
  const content = (
    <>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="size-16 shrink-0 rounded object-contain"
        />
      ) : (
        <span aria-hidden className="size-16 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{label}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {defKey}
        </p>
      </div>
      {current && (
        <StatusBadge tone="info" className="shrink-0">
          <CheckCircle2 /> Current
        </StatusBadge>
      )}
    </>
  );

  if (current) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary/60 bg-primary/5 p-2">
        {content}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-2 transition-colors hover:border-border hover:bg-accent/50"
    >
      {content}
    </Link>
  );
}

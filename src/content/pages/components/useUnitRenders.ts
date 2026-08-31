/**
 * A unit's four rendered angles for its own page (issue #1951): a plan from
 * above and three pictures of the model, laid out the way the hub's
 * encyclopedia does.
 *
 * Cache first, draw second. The cache read (`unitsync_local_renders`, wrapped
 * by `localRenders`) costs a few hundred bytes off disk per angle and needs no
 * model, so a render this machine already drew shows up the moment the page
 * opens. Only the angles the cache read did not find are drawn, and only once
 * the model this page's hero is already loading has arrived: there is no
 * second model read here. A freshly drawn render is written back
 * (`unitsync_unit_render`) and indexed (`unitsync_remember_render`, wrapped by
 * `rememberLocalRender`) so the next visit's cache read finds it. That last
 * step is what the old build-tree "Render" button never took, which was the
 * whole of why a render it produced vanished the moment you navigated away.
 *
 * The cache read has to finish, one way or the other, before the draw pass
 * starts. Racing them would mean the draw pass claims an angle before the
 * cache read has said whether it already exists, which is exactly the
 * redraw-of-a-cached-picture this hook exists to avoid.
 */

import { useEffect, useRef, useState } from "react";
import type { UnitModelResult } from "@/content/bindings";
import { unitsyncUnitRender } from "@/content/bindings";
import { localRenders, rememberLocalRender } from "@/hub/assets/localRenders";
import { RENDER_VERSION, renderUnit } from "@/hub/assets/renderTop";
import { RENDER_ANGLES, renderVariant } from "@/hub/assets/vocabulary";
import { hubAssetUrl } from "@/lib/assetUrl";
import { toBase64 } from "@/lib/base64";
import { renderSkipReason } from "./UnitModelPanel";

/** The label each angle is shown under, matching the hub encyclopedia's own
 *  wording. */
const ANGLE_LABELS: Record<string, string> = {
  top: "Top down",
  front: "Front",
  side: "Side",
  angled: "Angled",
};

/** An angle's label, or the raw angle for one the vocabulary added after this
 *  was written rather than a blank card. */
export function angleLabel(angle: string): string {
  return ANGLE_LABELS[angle] ?? angle;
}

export interface AngleRender {
  angle: string;
  /** `"checking"` while the cache read is in flight, `"drawing"` while this
   *  machine draws a fresh one, `"ready"` with a `url`, and `"unavailable"`
   *  with a `message` saying why there is nothing to show. */
  status: "checking" | "drawing" | "ready" | "unavailable";
  url?: string;
  message?: string;
}

function initialRenders(): Record<string, AngleRender> {
  return Object.fromEntries(
    RENDER_ANGLES.map((angle) => [
      angle,
      { angle, status: "checking" as const },
    ]),
  );
}

function unavailableRenders(message: string): Record<string, AngleRender> {
  return Object.fromEntries(
    RENDER_ANGLES.map((angle) => [
      angle,
      { angle, status: "unavailable" as const, message },
    ]),
  );
}

/**
 * The four angles, cached first and drawn second.
 *
 * Every argument left optional, and the hook does nothing until all of
 * `enginePath`/`dataDir`/`gameArchive`/`unitId`/`object` are known, the same
 * shape `useUnitsyncUnitModel` takes: the caller has this loading in the same
 * render pass as everything else on the page, ahead of any early return, so
 * the values it is handed are whatever is true yet.
 *
 * `gameShortname` is the game's modinfo shortname, which is what the render
 * cache is keyed on, never the archive name. A game with none (rare, since the
 * engine does not require one) cannot be looked up or remembered, so this
 * still draws every angle fresh each visit rather than persisting them, and
 * says so nowhere on screen because a missing shortname is not something a
 * player did wrong.
 */
export function useUnitRenders(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
  gameShortname?: string,
  unitId?: string,
  object?: string,
  footprintX?: number,
  footprintZ?: number,
  model?: UnitModelResult | null,
): Record<string, AngleRender> {
  const [renders, setRenders] = useState<Record<string, AngleRender>>(
    initialRenders(),
  );
  // Which angles the cache read already found (or the draw pass has already
  // claimed), so the draw effect below knows what is left without racing the
  // cache read that runs alongside it.
  const settled = useRef<Set<string>>(new Set());
  const [cacheChecked, setCacheChecked] = useState(false);

  // A different unit (or a game update swapping the archive) starts over:
  // nothing carries across from whatever the previous unit had found or drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unitId and gameArchive are the reset trigger, not read by the body
  useEffect(() => {
    settled.current = new Set();
    setCacheChecked(false);
    setRenders(initialRenders());
  }, [unitId, gameArchive]);

  // Step 1: read the cache. Independent of the model, so a render this
  // machine already drew appears before the model has finished loading.
  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || !unitId) return;
    if (!object) {
      setRenders(
        unavailableRenders(
          "This unit's definition names no model, so there is nothing to render.",
        ),
      );
      setCacheChecked(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (gameShortname) {
        const found = await Promise.all(
          RENDER_ANGLES.map(async (angle) => {
            const held = await localRenders(
              gameShortname,
              renderVariant(angle),
              RENDER_VERSION,
              [unitId],
              gameArchive,
            );
            return { angle, render: held.get(unitId) };
          }),
        );
        if (cancelled) return;
        for (const { angle, render } of found) {
          if (!render) continue;
          settled.current.add(angle);
          setRenders((prev) => ({
            ...prev,
            [angle]: { angle, status: "ready", url: hubAssetUrl(render.file) },
          }));
        }
      }
      if (!cancelled) setCacheChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, gameShortname, unitId, object]);

  // Step 2: draw whatever the cache did not have, once the cache read has had
  // its say and the model (already loading for the hero above) has arrived.
  useEffect(() => {
    if (
      !enginePath ||
      !dataDir ||
      !gameArchive ||
      !unitId ||
      !object ||
      !cacheChecked ||
      !model?.root
    )
      return;
    const toDraw = RENDER_ANGLES.filter((angle) => !settled.current.has(angle));
    if (toDraw.length === 0) return;
    // Claimed before the first await, so a second run of this effect (a
    // dependency changing while a draw is in flight) does not draw the same
    // angle twice.
    for (const angle of toDraw) settled.current.add(angle);
    let cancelled = false;
    void (async () => {
      for (const angle of toDraw) {
        if (cancelled) return;
        setRenders((prev) => ({
          ...prev,
          [angle]: { angle, status: "drawing" },
        }));
        await drawOne(angle);
      }
    })();

    async function drawOne(angle: string): Promise<void> {
      try {
        const drawn = await renderUnit(
          angle,
          model as UnitModelResult,
          footprintX ?? 1,
          footprintZ ?? 1,
        );
        const encoded = await unitsyncUnitRender({
          enginePath: enginePath as string,
          dataDir: dataDir as string,
          gameArchive: gameArchive as string,
          object: object as string,
          angle,
          footprintX: footprintX ?? 1,
          footprintZ: footprintZ ?? 1,
          rendererVersion: RENDER_VERSION,
          pixels: toBase64(drawn.rgba),
          width: drawn.width,
          height: drawn.height,
        });
        if (cancelled) return;
        if (encoded.asset) {
          setRenders((prev) => ({
            ...prev,
            [angle]: { angle, status: "ready", url: encoded.dataUrl },
          }));
          // Best effort: a render that could not be indexed was still drawn
          // and is on screen now, and this is what makes the next visit's
          // cache read find it. Failing the draw over the bookkeeping would
          // be the wrong trade, the same call `blueprintBackfill.ts` makes.
          if (gameShortname) {
            void rememberLocalRender(
              gameShortname,
              unitId as string,
              encoded.asset,
            );
          }
        } else {
          setRenders((prev) => ({
            ...prev,
            [angle]: {
              angle,
              status: "unavailable",
              message: encoded.assetSkipped
                ? renderSkipReason(encoded.assetSkipped)
                : (encoded.errors[0] ?? "This angle could not be drawn."),
            },
          }));
        }
      } catch (e) {
        if (cancelled) return;
        setRenders((prev) => ({
          ...prev,
          [angle]: {
            angle,
            status: "unavailable",
            message: e instanceof Error ? e.message : String(e),
          },
        }));
      }
    }

    return () => {
      cancelled = true;
    };
  }, [
    enginePath,
    dataDir,
    gameArchive,
    gameShortname,
    unitId,
    object,
    footprintX,
    footprintZ,
    model,
    cacheChecked,
  ]);

  return renders;
}

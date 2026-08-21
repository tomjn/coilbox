/**
 * The pictures for one plan's buildings (issue #1721), from this machine first and
 * the hub second (issue #1724).
 *
 * Coilbox drew these pictures in the first place. `./renderTop.ts` draws a unit
 * from above out of the real model, `./blueprintBackfill.ts` has the worker encode
 * it and writes down which unit it is of, and only then does it go to the hub. So
 * the machine that made a picture is the one most likely to hold it, and asking
 * the hub for it first was drawing somebody's own base out of the network.
 *
 * Local first means a plan is drawn as its buildings offline, on a hub holding
 * nothing for this game, and for a game nobody else plays. The hub is then asked
 * only about the units this machine has not got, which is also fewer rows to look
 * up.
 *
 * One request per plan either way, however many buildings it has: `./localRenders`
 * takes the whole layout in one call, and `./heldPictures.ts` queues each hub ask
 * and flushes them on a microtask. An answer is remembered for the session so the
 * same unit on a second plan is not asked about again.
 *
 * A profile that switched the hub off asks it nothing, the same gate
 * `useHeldMapPicture` applies. It still gets this machine's own renders, which is
 * the point: a plan is drawn in the library, in the import drawers and on the hub
 * page, and the first two are reachable with no hub at all.
 */

import { useEffect, useMemo, useState } from "react";
import { isHubEnabled } from "@/profile/profile";
import { useHubUrl } from "../config";
import { heldPicture } from "./heldPictures";
import { localPlanPicture, localRenders } from "./localRenders";
import { RENDER_VERSION } from "./renderTop";
import { assetCdnBase } from "./tier";
import {
  PLAN_VARIANT,
  type PlanPicture,
  planPicture,
  unitPictureIdentity,
} from "./unitPictures";

/** Every building's picture, keyed on the lower cased def, and empty until the
 *  answers are in. A def nothing holds a picture of is absent rather than null, so
 *  a caller draws its square by not finding it. */
export function useHeldUnitPictures(
  game: string | null | undefined,
  defs: readonly string[],
  /** The game's archive, when the caller knows which one this plan is for. Given,
   *  a render drawn against a different one is not used, so a game update does not
   *  leave the old model on the plan. A caller without one still gets its renders
   *  and the `RENDER_VERSION` check on them. */
  archive?: string,
): ReadonlyMap<string, PlanPicture> {
  const [pictures, setPictures] = useState<ReadonlyMap<string, PlanPicture>>(
    new Map(),
  );

  // The defs a plan names, once each and in a stable order, so a redraw of the
  // same layout does not ask again. The identity of the array itself changes on
  // every render of the caller, which is why this is joined into a string.
  const wanted = useMemo(
    () => [...new Set(defs.map((def) => def.toLowerCase()))].sort().join("\n"),
    [defs],
  );
  const hubUrl = useHubUrl();

  useEffect(() => {
    setPictures(new Map());
    if (!game || !wanted) return;
    let live = true;
    const names = wanted.split("\n");

    void (async () => {
      const found = new Map<string, PlanPicture>();
      const held = await localRenders(
        game,
        PLAN_VARIANT,
        RENDER_VERSION,
        names,
        archive,
      );
      if (!live) return;
      for (const [def, render] of held) {
        found.set(def, localPlanPicture(render));
      }
      // Shown as soon as this machine's own are in, rather than held back behind
      // a hub that may be slow or asleep.
      if (found.size) setPictures(new Map(found));

      const missing = names.filter((def) => !found.has(def));
      if (!missing.length || !isHubEnabled()) return;
      const answers = await Promise.all(
        missing.map((def) =>
          heldPicture(hubUrl, unitPictureIdentity(game, def)),
        ),
      );
      if (!live) return;
      const cdnBase = assetCdnBase();
      answers.forEach((answer, at) => {
        const picture = planPicture(answer, cdnBase);
        if (picture) found.set(missing[at], picture);
      });
      setPictures(new Map(found));
    })();

    return () => {
      live = false;
    };
  }, [game, wanted, hubUrl, archive]);

  return pictures;
}

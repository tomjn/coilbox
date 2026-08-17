/**
 * The pictures for one plan's buildings, once the hub has answered (issue #1721).
 *
 * One request per plan, however many buildings it has: `./heldPictures.ts` queues
 * each ask and flushes them on a microtask, so the whole layout's units go in one
 * batch, and an answer is remembered for the session so the same unit on a second
 * plan is not asked about again.
 *
 * A profile that switched the hub off asks it nothing, the same gate
 * `useHeldMapPicture` applies. A plan is drawn in the library, in the import
 * drawers and on the hub page, and the first two are reachable with no hub at all.
 */

import { useEffect, useMemo, useState } from "react";
import { isHubEnabled } from "@/profile/profile";
import { useHubUrl } from "../config";
import { heldPicture } from "./heldPictures";
import { assetCdnBase } from "./tier";
import {
  type PlanPicture,
  planPicture,
  unitPictureIdentity,
} from "./unitPictures";

/** Every building's picture, keyed on the lower cased def, and empty until the hub
 *  has answered. A def the hub holds nothing for is absent rather than null, so a
 *  caller draws its square by not finding it. */
export function useHeldUnitPictures(
  game: string | null | undefined,
  defs: readonly string[],
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
    if (!game || !wanted || !isHubEnabled()) return;
    let live = true;
    const names = wanted.split("\n");
    Promise.all(
      names.map((def) => heldPicture(hubUrl, unitPictureIdentity(game, def))),
    ).then((answers) => {
      if (!live) return;
      const cdnBase = assetCdnBase();
      const found = new Map<string, PlanPicture>();
      answers.forEach((answer, at) => {
        const picture = planPicture(answer, cdnBase);
        if (picture) found.set(names[at], picture);
      });
      setPictures(found);
    });
    return () => {
      live = false;
    };
  }, [game, wanted, hubUrl]);

  return pictures;
}

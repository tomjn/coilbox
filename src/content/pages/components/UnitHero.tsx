/**
 * A unit's own page leads with its model: full width, at a size worth
 * orbiting, rather than the 288px column {@link ./UnitModelPanel} draws
 * beside the build tree. The viewport itself ({@link ModelViewport}) is the
 * same shared component that panel uses, so this is a different frame around
 * the same drawing rather than a second way of drawing a model.
 *
 * Nothing below this waits for the model to arrive: the caller renders the
 * page's identity block and stats the moment it has a unit, and this fills
 * its box whenever the model resolves. Each state below (no model, loading,
 * failed, undrawable) is what is actually true at that instant, mirroring
 * `UnitModelPanel`'s own `Body` states but without its metadata rows, which
 * `GameUnitPage` shows further down the page as a quiet block instead.
 */

import type { UnitModelResult } from "@/content/bindings";
import { countTriangles } from "../../unitModel";
import { ModelNotes, ModelViewport, Note } from "./ModelViewport";

export function UnitHero({
  object,
  model,
  loading,
  failed,
  gameArchive,
}: {
  object?: string;
  model: UnitModelResult | null;
  loading: boolean;
  failed: boolean;
  gameArchive: string;
}) {
  if (!object) {
    return (
      <Note>
        This unit&apos;s definition names no model, so the engine draws nothing
        for it either.
      </Note>
    );
  }
  if (loading) {
    return (
      <Note>
        Reading <span className="font-mono">{object}</span> out of {gameArchive}
        .
      </Note>
    );
  }
  if (failed) {
    return (
      <Note>Could not reach unitsync to read this unit&apos;s model.</Note>
    );
  }
  if (!model) return null;

  const triangles = model.root ? countTriangles(model.root) : 0;
  if (!model.root || triangles === 0) {
    return (
      <Note>
        {model.errors[0] ??
          `Nothing drawable came out of ${object}: it has pieces but no faces.`}
      </Note>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border/50 bg-card">
      <ModelViewport model={model} className="h-[26rem] w-full sm:h-[34rem]" />
      <ModelNotes model={model} archive={gameArchive} />
    </div>
  );
}

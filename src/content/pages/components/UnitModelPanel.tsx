/**
 * One unit's model as the game ships it, beside the build tree rather than over
 * it, so the tree stays visible while comparing units.
 *
 * Read only, and deliberately not the unit builder's viewport: that one is
 * eleven editing callbacks and a scene of gizmos, anchors and bake caches around
 * a project the builder owns, and a game's model is neither a project nor
 * editable. The shape copied here is the parts picker's detail viewport.
 */

import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useState } from "react";

import { RENDER_VERSION, renderUnit } from "@/hub/assets/renderTop";
import { RENDER_ANGLES, renderFrame } from "@/hub/assets/vocabulary";
import { toBase64 } from "@/lib/base64";
import type {
  RenderSkip,
  UnitDatasetEntry,
  UnitModelResult,
  UnitRenderResult,
} from "../../bindings";
import { unitsyncUnitRender } from "../../bindings";
import { useUnitsyncUnitModel } from "../../config";
import { countPieces, countTriangles } from "../../unitModel";
import { ModelNotes, ModelViewport, Note } from "./ModelViewport";

interface Props {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  /** The unit's internal (lowercased) name, as the build tree keys nodes by. */
  unitId: string;
  /** Its dataset entry, which is where the model's name comes from. */
  unit?: UnitDatasetEntry;
  onClose: () => void;
}

export function UnitModelPanel({
  enginePath,
  dataDir,
  gameArchive,
  unitId,
  unit,
  onClose,
}: Props) {
  const object = unit?.objectName?.trim();
  const { model, loading, failed } = useUnitsyncUnitModel(
    enginePath,
    dataDir,
    gameArchive,
    object,
  );

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto rounded-lg border border-border/50 bg-card">
      <header className="flex items-start justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium leading-tight">
            {unit?.fullName ?? unitId}
          </h3>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {unitId}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close model view"
        >
          <X size={16} />
        </Button>
      </header>

      <Body
        object={object}
        model={model}
        loading={loading}
        failed={failed}
        gameArchive={gameArchive}
      />

      {model?.root && object && (
        <HubRender
          enginePath={enginePath}
          dataDir={dataDir}
          gameArchive={gameArchive}
          object={object}
          model={model}
          footprintX={unit?.footprintX ?? 1}
          footprintZ={unit?.footprintZ ?? 1}
        />
      )}
    </aside>
  );
}

/**
 * Everything below the header. Split out so each way of having nothing to draw
 * says which one it is: an empty viewport that looks like a bug is worse than a
 * sentence explaining there is no model.
 */
function Body({
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
        This unit's definition names no model, so the engine draws nothing for
        it either.
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
    return <Note>Could not reach unitsync to read this unit's model.</Note>;
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
    <>
      <ModelViewport
        model={model}
        className="aspect-square w-full border-b border-border/50"
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3 py-2 text-xs">
        <dt className="text-muted-foreground">Model</dt>
        <dd className="break-all font-mono">{model.path}</dd>

        <dt className="text-muted-foreground">Format</dt>
        <dd>{model.format === "3do" ? "3do (Total Annihilation)" : "s3o"}</dd>

        <dt className="text-muted-foreground">Size</dt>
        <dd>
          {triangles.toLocaleString()} triangles in{" "}
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

      <ModelNotes model={model} archive={gameArchive} />
    </>
  );
}

/**
 * The unit's top down render for the hub (issue #1631).
 *
 * A blueprint on the hub draws one rounded square per building, and this is the
 * picture that replaces it. It lives here because this is the one place in
 * coilbox that already has a unit's model on screen, so a person can compare what
 * came out of the encoder against what the model looks like.
 *
 * Nothing uploads it yet, which is #1633. What this does is produce the file and
 * show what is in it, including the two hashes: the encoded one names the object
 * and the source one is the identity the have check compares on.
 */
function HubRender({
  enginePath,
  dataDir,
  gameArchive,
  object,
  model,
  footprintX,
  footprintZ,
}: {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  object: string;
  model: UnitModelResult;
  footprintX: number;
  footprintZ: number;
}) {
  const [result, setResult] = useState<UnitRenderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = renderFrame(footprintX, footprintZ);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const drawn = await renderUnit(
        RENDER_ANGLES[0],
        model,
        footprintX,
        footprintZ,
      );
      setResult(
        await unitsyncUnitRender({
          enginePath,
          dataDir,
          gameArchive,
          object,
          angle: RENDER_ANGLES[0],
          footprintX,
          footprintZ,
          rendererVersion: RENDER_VERSION,
          pixels: toBase64(drawn.rgba),
          width: drawn.width,
          height: drawn.height,
        }),
      );
    } catch (e) {
      setResult({ errors: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-border/50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium">Top down render</h4>
        <Button size="sm" variant="secondary" onClick={run} disabled={busy}>
          {busy ? "Rendering…" : "Render"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {footprintX} by {footprintZ} squares, framed with a square of bleed on
        each side, so {frame.widthPx} by {frame.heightPx} pixels.
      </p>

      {result?.dataUrl && (
        // Checkerboard behind it, because the whole point is that the background
        // is not there: on a plain card a transparent render and an opaque one
        // with a matching background look the same.
        <div
          className="mt-2 flex justify-center rounded border border-border/50 p-2"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%),linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 8px 8px",
          }}
        >
          <img
            src={result.dataUrl}
            alt={`Top down render of ${object}`}
            className="max-w-full"
          />
        </div>
      )}

      {result?.asset && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Size</dt>
          <dd>
            {result.asset.width} by {result.asset.height},{" "}
            {(result.asset.bytes / 1024).toFixed(1)} KB,{" "}
            {result.asset.encodeProfile}
          </dd>

          <dt className="text-muted-foreground">Identity</dt>
          <dd className="break-all font-mono">{result.asset.sourceHash}</dd>

          <dt className="text-muted-foreground">File</dt>
          <dd className="break-all font-mono">{result.asset.path}</dd>
        </dl>
      )}

      {result?.assetSkipped && (
        <Note>
          No render was stored: {renderSkipReason(result.assetSkipped)}
        </Note>
      )}
      {result && result.errors.length > 0 && (
        <Note>{result.errors.join(". ")}</Note>
      )}
    </section>
  );
}

/** What each refusal means, in a sentence, because the reasons are different
 *  problems with different owners. */
function renderSkipReason(skip: RenderSkip): string {
  switch (skip) {
    case "mis-framed":
      return "the picture is not the shape this unit's footprint frames to, which is a bug in coilbox rather than in the game.";
    case "no-pixels":
      return "the pixels did not reach the worker intact.";
    case "unknown-angle":
      return "coilbox asked for an angle the hub does not store.";
    case "no-model":
      return "the game's archive has no model for this unit.";
    case "encode-failed":
      return "libwebp refused the picture.";
    case "too-large":
      return "it encoded past the size the hub accepts.";
    case "not-written":
      return "it encoded, and the file could not be written.";
  }
}

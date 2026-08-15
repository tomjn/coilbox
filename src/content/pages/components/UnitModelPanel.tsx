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
import { useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  RENDER_VERSION,
  renderTopDown,
  toBase64,
} from "@/hub/assets/renderTop";
import { RENDER_ANGLES, renderFrame } from "@/hub/assets/vocabulary";
import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import type {
  RenderSkip,
  UnitDatasetEntry,
  UnitModelResult,
  UnitRenderResult,
} from "../../bindings";
import { unitsyncUnitRender } from "../../bindings";
import { useUnitsyncUnitModel } from "../../config";
import { buildModel, countPieces, countTriangles } from "../../unitModel";

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

  const missing = model.textures.filter((t) => !t.file && !t.teamColour);
  const teamColour = model.textures.filter((t) => t.teamColour);

  return (
    <>
      <ModelViewport model={model} />
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

      {teamColour.length > 0 && (
        <Note>
          {teamColour.length} of this model's textures are team-colour regions,
          which the engine paints in the owning player's colour. There is no
          player here, so they are drawn in one blue.
        </Note>
      )}

      {missing.length > 0 && (
        <Note>
          {missing.length} of this model's textures are not in {gameArchive}, so
          those faces are drawn plain:{" "}
          <span className="font-mono">
            {missing.map((t) => t.name).join(", ")}
          </span>
          .
        </Note>
      )}
      {model.paletteFaces > 0 && (
        <Note>
          {model.paletteFaces.toLocaleString()} faces are a flat colour from the
          Total Annihilation palette, which the engine holds rather than the
          archive. They are drawn plain grey.
        </Note>
      )}
      {model.errors.length > 0 && <Note>{model.errors.join(". ")}</Note>}
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
      const drawn = await renderTopDown(model, footprintX, footprintZ);
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-3 rounded border border-border/50 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** The model itself, framed on its own extent and orbitable. */
function ModelViewport({ model }: { model: UnitModelResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReduceMotion();

  useCanvas3D(
    containerRef,
    ({ renderer }) => {
      const built = buildModel(model);

      const scene = new THREE.Scene();
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(4, 8, 6);
      const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
      fill.position.set(-5, 2, -4);
      scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));
      scene.add(built.object);

      // Framed on the model's own bounding box rather than the header's radius,
      // which both formats let the engine work out and so is often absent. Not
      // `frameBox` from the unit builder: its distance is capped at 60 for the
      // builder's grid, and a game unit is engine units across, so a commander
      // at 32 units of radius wants a camera about 105 out and would be clipped.
      const centre = built.box.getCenter(new THREE.Vector3());
      const radius = Math.max(
        built.box.getBoundingSphere(new THREE.Sphere()).radius,
        0.001,
      );
      const camera = new THREE.PerspectiveCamera(
        35,
        1,
        radius / 100,
        radius * 100,
      );
      camera.position.set(
        centre.x + radius * 1.6,
        centre.y + radius * 1.2,
        centre.z + radius * 1.9,
      );

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(centre);
      controls.enableDamping = !reduceMotion;
      controls.enablePan = false;
      controls.minDistance = radius * 0.4;
      controls.maxDistance = radius * 8;
      controls.update();

      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);

      // Damping needs a frame loop to settle. Without it the view still moves,
      // it just stops the moment the pointer does.
      let frame = 0;
      if (!reduceMotion) {
        const tick = () => {
          controls.update();
          render();
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }

      return {
        render,
        resize: (width, height) => {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        },
        dispose: () => {
          cancelAnimationFrame(frame);
          controls.removeEventListener("change", render);
          controls.dispose();
          built.dispose();
        },
      };
    },
    [model, reduceMotion],
  );

  return (
    <div
      ref={containerRef}
      className="aspect-square w-full border-b border-border/50"
    />
  );
}

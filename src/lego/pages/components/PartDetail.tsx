/**
 * Everything about one part, beside the grid rather than over it, so the
 * picker stays visible while comparing pieces.
 *
 * The viewport here is orbitable, unlike the grid's fixed three quarter view,
 * because checking a piece usually means looking at the face the grid hides.
 */

import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { Fragment, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { baseAtlas } from "../../atlas";
import { addStandardLights, partMaterial } from "../../geometry";
import {
  getPartGeometry,
  type LegoPartInfo,
  type LoadedPack,
  partDimensions,
  partSize,
  shapeVariants,
} from "../../pack";
import { getShapeGeometry, type ShapeKind } from "../../shapes";

interface Props {
  pack: LoadedPack;
  part: LegoPartInfo;
  onSelect: (part: LegoPartInfo) => void;
  onClose: () => void;
}

export function PartDetail({ pack, part, onSelect, onClose }: Props) {
  const variants = shapeVariants(pack, part.shapeId);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium leading-tight">{part.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {partDimensions(part)
              .map((n) => n.toFixed(2))
              .join(" x ")}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close part details"
        >
          <X size={16} />
        </Button>
      </header>

      <PartViewport
        pack={pack}
        geometry={getPartGeometry(pack, part.id)}
        size={partSize(part)}
      />

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-xs">
        {variants.length > 1 ? (
          <>
            <dt className="text-muted-foreground">Colourway</dt>
            <dd className="flex flex-wrap gap-1">
              {variants.map((variant) => (
                <Button
                  key={variant.id}
                  size="sm"
                  variant={variant.id === part.id ? "default" : "outline"}
                  onClick={() => onSelect(variant)}
                >
                  {variant.colourway}
                </Button>
              ))}
            </dd>
          </>
        ) : null}

        <dt className="text-muted-foreground">Shape</dt>
        <dd>{part.shape}</dd>

        <dt className="text-muted-foreground">Tags</dt>
        <dd>{part.tags.join(", ")}</dd>

        <dt className="text-muted-foreground">Triangles</dt>
        <dd>
          {part.iCount / 3} from {part.vCount} vertices
        </dd>

        <dt className="text-muted-foreground">Atlas</dt>
        <dd>
          {part.uvBox.min.map((n) => n.toFixed(2)).join(", ")} to{" "}
          {part.uvBox.max.map((n) => n.toFixed(2)).join(", ")}
        </dd>

        {pack.library.packs.length > 1 ? (
          <>
            <dt className="text-muted-foreground">Pack</dt>
            <dd>{part.packId}</dd>
          </>
        ) : null}

        <dt className="text-muted-foreground">Part id</dt>
        <dd className="font-mono">{part.id}</dd>

        <dt className="text-muted-foreground">In the source</dt>
        <dd className="font-mono break-all">{part.sourceNames.join(", ")}</dd>
      </dl>

      {part.uvIncomplete ? (
        <p className="mx-4 mb-3 rounded border border-border px-3 py-2 text-xs text-muted-foreground">
          {part.uvIncomplete} corners of this part were never given a texture
          coordinate in the source, so they sample the corner of the atlas.
        </p>
      ) : null}
    </aside>
  );
}

/**
 * Everything about one generated shape kind (#3337), where `PartDetail` has a
 * part. A shape has no pack, colourway or part id, so it shows the kind, its
 * default size and its search tags, over a preview that turns.
 */
export function ShapeDetail({
  pack,
  shape,
  onClose,
}: {
  pack: LoadedPack;
  shape: ShapeKind;
  onClose: () => void;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium leading-tight">{shape.label}</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close shape details"
        >
          <X size={16} />
        </Button>
      </header>

      <PartViewport
        pack={pack}
        geometry={getShapeGeometry({
          kind: shape.kind,
          size: shape.size,
          ...(shape.options ? { options: shape.options } : {}),
        })}
        size={Math.max(...shape.size)}
        spin={!reduceMotion}
      />

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-xs">
        <dt className="text-muted-foreground">Kind</dt>
        <dd className="font-mono">{shape.kind}</dd>

        <dt className="text-muted-foreground">Size</dt>
        <dd>{shape.size.join(" x ")}</dd>

        {Object.entries(shape.options ?? {}).map(([name, value]) => (
          <Fragment key={name}>
            <dt className="text-muted-foreground">{name}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}

        <dt className="text-muted-foreground">Tags</dt>
        <dd>{shape.tags.join(", ")}</dd>
      </dl>
    </aside>
  );
}

/**
 * A single piece of geometry, framed and orbitable, turning by itself when
 * `spin` is set. Rebuilt whenever the geometry changes.
 */
function PartViewport({
  pack,
  geometry,
  size,
  spin = false,
}: {
  pack: LoadedPack;
  geometry: THREE.BufferGeometry | null;
  /** The longest side, which sets how the camera frames it. */
  size: number;
  spin?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useCanvas3D(
    containerRef,
    ({ renderer }) => {
      if (!geometry) return;

      const scene = new THREE.Scene();
      addStandardLights(scene);
      scene.add(new THREE.Mesh(geometry, partMaterial(baseAtlas(pack))));

      // Frame the part rather than the scene, so a sliver fills the view as much
      // as a hull section does.
      const radius = Math.max(size, 0.001);
      const camera = new THREE.PerspectiveCamera(
        35,
        1,
        radius / 100,
        radius * 100,
      );
      camera.position.set(radius * 1.6, radius * 1.2, radius * 1.9);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.minDistance = radius * 0.8;
      controls.maxDistance = radius * 6;

      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);

      // `update` turns the camera and fires "change", which draws.
      controls.autoRotate = spin;
      let frame = 0;
      const turn = () => {
        controls.update();
        frame = requestAnimationFrame(turn);
      };
      if (spin) frame = requestAnimationFrame(turn);

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
        },
      };
    },
    [pack, geometry, size, spin],
  );

  return (
    <div
      ref={containerRef}
      className="aspect-square w-full border-b border-border"
    />
  );
}

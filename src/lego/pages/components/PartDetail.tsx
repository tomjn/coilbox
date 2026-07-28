/**
 * Everything about one part, beside the grid rather than over it, so the
 * picker stays visible while comparing pieces.
 *
 * The viewport here is orbitable, unlike the grid's fixed three quarter view,
 * because checking a piece usually means looking at the face the grid hides.
 */

import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { useReduceMotion } from "../../../general/display";
import { addStandardLights, partMaterial } from "../../geometry";
import {
  getPartGeometry,
  type LegoPartInfo,
  type LoadedPack,
  partDimensions,
  partSize,
  shapeVariants,
} from "../../pack";

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

      <PartViewport pack={pack} part={part} />

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

/** A single part, framed and orbitable. Rebuilt whenever the part changes. */
function PartViewport({
  pack,
  part,
}: {
  pack: LoadedPack;
  part: LegoPartInfo;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    const container = containerRef.current;
    const geometry = getPartGeometry(pack, part.id);
    if (!container || !geometry) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    addStandardLights(scene);
    scene.add(new THREE.Mesh(geometry, partMaterial(pack.manifest)));

    // Frame the part rather than the scene, so a sliver fills the view as much
    // as a hull section does.
    const radius = Math.max(partSize(part), 0.001);
    const camera = new THREE.PerspectiveCamera(
      35,
      1,
      radius / 100,
      radius * 100,
    );
    camera.position.set(radius * 1.6, radius * 1.2, radius * 1.9);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reduceMotion;
    controls.enablePan = false;
    controls.minDistance = radius * 0.8;
    controls.maxDistance = radius * 6;

    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

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

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [pack, part, reduceMotion]);

  return (
    <div
      ref={containerRef}
      className="aspect-square w-full border-b border-border"
    />
  );
}

/**
 * A model out of a game archive, drawn and orbitable, plus the sentences that
 * say what could not be drawn faithfully.
 *
 * Shared by the two doors onto the same read: the unit panel beside the build
 * tree ({@link ./UnitModelPanel}) and the archive browser's preview pane
 * ({@link ./ArchiveModelPreview}, issue #698). Both hand it a
 * {@link UnitModelResult} from `unitsync_unit_model`, so neither has its own way
 * of reading a model or of resolving its textures.
 */

import { useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import type { UnitModelResult } from "../../bindings";
import { buildModel } from "../../unitModel";

/** One caveat, in a sentence. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-3 rounded border border-border/50 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * What is on screen but not right, and why.
 *
 * Every one of these is a difference between what the engine draws and what this
 * draws, and each has a different owner: a team colour is the player's, a missing
 * texture is the archive's, and the Total Annihilation palette is the engine's.
 * Saying nothing would leave a grey or blue unit looking like a bug in coilbox.
 */
export function ModelNotes({
  model,
  archive,
}: {
  model: UnitModelResult;
  archive: string;
}) {
  const missing = model.textures.filter((t) => !t.file && !t.teamColour);
  const teamColour = model.textures.filter((t) => t.teamColour);

  return (
    <>
      {teamColour.length > 0 && (
        <Note>
          {teamColour.length} of this model&apos;s textures are team-colour
          regions, which the engine paints in the owning player&apos;s colour.
          There is no player here, so they are drawn in one blue.
        </Note>
      )}

      {missing.length > 0 && (
        <Note>
          {missing.length} of this model&apos;s textures are not in {archive},
          so those faces are drawn plain:{" "}
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

/** The model itself, framed on its own extent and orbitable. */
export function ModelViewport({
  model,
  className = "aspect-square w-full",
}: {
  model: UnitModelResult;
  /** The viewport's own box. It fills whatever it is given, so a panel sizes it
   *  by aspect and a preview pane by the space it has. */
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReduceMotion();

  useCanvas3D(
    containerRef,
    ({ renderer, host }) => {
      const built = buildModel(model);

      const scene = new THREE.Scene();
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(4, 8, 6);
      const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
      fill.position.set(-5, 2, -4);
      scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));
      scene.add(built.object);

      // Framed on the model's own bounding box rather than the header's radius,
      // which both formats let the engine work out and so is often absent.
      //
      // Still not `frameBox` from the unit builder, now that nothing caps its
      // distance. `frameBox` fits the bounding sphere and pads it, which is
      // 4.3 radii at this lens. Sitting at 2.8 fills the view with the model
      // rather than the space around it, and this is a preview nobody orbits
      // out of. Its floor of 1.5 world units would work against a small model
      // here too, where the near plane scales with the model instead of being
      // fixed, so there is no absolute distance to be too close from.
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

      // The hero placement on the unit page puts far more empty space around
      // the model than there is model, so a scroll anywhere on the canvas
      // used to zoom rather than scroll the page. OrbitControls listens for
      // `wheel` on the canvas itself and always calls `preventDefault`, so
      // the only way to let an empty-space scroll through to the page is to
      // stop that event before it gets there. A capture-phase listener on
      // `host`, the canvas's own parent, runs before the canvas's own
      // listeners however they were registered, so `stopPropagation` here
      // keeps OrbitControls from ever seeing the event. `raycaster` and
      // `pointer` are reused across events rather than built per scroll, and
      // a miss over empty space costs one bounding-sphere test per mesh, not
      // one per triangle, because that is where three's own hit test bails
      // out first.
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const onWheel = (event: WheelEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObject(built.object, true).length === 0) {
          event.stopPropagation();
        }
      };
      host.addEventListener("wheel", onWheel, {
        capture: true,
        passive: true,
      });

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
          host.removeEventListener("wheel", onWheel, { capture: true });
          controls.removeEventListener("change", render);
          controls.dispose();
          built.dispose();
        },
      };
    },
    [model, reduceMotion],
  );

  return <div ref={containerRef} className={className} />;
}

/**
 * A mission's chosen unit, turning slowly, as the briefing's backdrop or its
 * side graphic.
 *
 * The map-preview slots' opposite number: same two shapes (a full-bleed
 * non-interactive backdrop and a drag-to-rotate graphic beside the card) and the
 * same stored spin tuning. What it draws comes from `buildModel`, the one reader
 * the content browser, the lego builder's reference figure and the scenario
 * editor all use, so a unit looks the same wherever coilbox shows it.
 *
 * These take a model rather than reading one, because whether the model resolved
 * is what decides whether the slot draws a unit at all: a briefing whose player
 * does not have that unit falls back to the slot's image, and only the caller
 * holding the answer can choose between the two.
 */

import { useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { UnitModelResult } from "@/content/bindings";
import { buildModel } from "@/content/unitModel";
import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import type { UnitPreviewConfig } from "../../model";
import { clampSpin } from "../../slots";
import { UNIT_VIEW_DIRECTION, unitFitDistance } from "./unitFraming";

/** Vertical field of view, matching the content browser's unit viewer. */
const FOV = 35;

/** `OrbitControls.autoRotateSpeed` for a spin multiplier of 1, as the map
 *  previews use, so "2x" means the same thing in either kind of slot. */
const SPIN_BASE = 2.0;

/**
 * The mission's unit as the full-bleed briefing backdrop: turning, no controls,
 * over the same dark gradient the imageless briefing uses. The gradient also
 * covers the moment before the model has been read, so the backdrop never
 * flashes blank.
 */
export function MissionUnitBackground({
  model,
  config,
}: {
  model: UnitModelResult | null;
  config: UnitPreviewConfig;
}) {
  return (
    <div className="h-full w-full bg-gradient-to-br from-slate-900 to-slate-950">
      {model && (
        <UnitSpinner
          model={model}
          spin={clampSpin(config.spinSpeed)}
          interactive={false}
        />
      )}
    </div>
  );
}

/**
 * The mission's unit as the graphic beside the briefing card: turning, but
 * drag-to-rotate (the spin resumes on release), on a transparent canvas so it
 * layers over the backdrop. A soft skeleton stands in while the model is read.
 */
export function MissionUnitSideGraphic({
  model,
  config,
}: {
  model: UnitModelResult | null;
  config: UnitPreviewConfig;
}) {
  if (!model) {
    return (
      <div className="h-full w-full animate-pulse rounded-lg bg-muted/10" />
    );
  }
  return (
    <UnitSpinner model={model} spin={clampSpin(config.spinSpeed)} interactive />
  );
}

/**
 * One unit model on a canvas, framed on its own extent and turning about the
 * scene's centre.
 *
 * The camera orbits rather than the model turning under a fixed camera, so an
 * interactive slot's drag and its auto-spin are the same motion and cannot fight
 * each other. Framing is redone on every resize because the same model is drawn
 * in a panorama and in a narrow column, and a distance that fits one clips the
 * other.
 */
function UnitSpinner({
  model,
  spin,
  interactive,
}: {
  model: UnitModelResult;
  spin: number;
  interactive: boolean;
}) {
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

      const centre = built.box.getCenter(new THREE.Vector3());
      const radius = Math.max(
        built.box.getBoundingSphere(new THREE.Sphere()).radius,
        0.001,
      );
      const camera = new THREE.PerspectiveCamera(
        FOV,
        1,
        radius / 100,
        radius * 100,
      );
      const direction = new THREE.Vector3(...UNIT_VIEW_DIRECTION).normalize();
      // A first position on the viewing axis. `resize` runs before the first
      // frame and sets the distance the canvas's real shape needs.
      camera.position.copy(centre).addScaledVector(direction, radius * 3);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(centre);
      controls.enableDamping = !reduceMotion;
      controls.enableZoom = false;
      controls.enablePan = false;
      // A backdrop takes no pointer input, but `update()` still advances the
      // auto-orbit from the frame loop below.
      controls.enabled = interactive;
      const wantSpin = spin !== 0 && !reduceMotion;
      controls.autoRotate = wantSpin;
      controls.autoRotateSpeed = SPIN_BASE * spin;
      if (wantSpin && interactive) {
        controls.addEventListener("start", () => {
          controls.autoRotate = false;
        });
        controls.addEventListener("end", () => {
          controls.autoRotate = true;
        });
      }
      controls.update();

      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);

      // Both the spin and the damping that settles a drag need a frame loop.
      // Without one the view still moves, it just stops when the pointer does.
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
          // Keep whatever angle the orbit is at and change only how far out it
          // is, so a resize mid-spin does not snap the unit back to its pose.
          const distance = unitFitDistance(
            radius,
            (FOV * Math.PI) / 180,
            camera.aspect,
          );
          const away = camera.position.clone().sub(centre);
          if (away.lengthSq() === 0) away.copy(direction);
          camera.position
            .copy(centre)
            .addScaledVector(away.normalize(), distance);
          controls.update();
        },
        dispose: () => {
          cancelAnimationFrame(frame);
          controls.removeEventListener("change", render);
          controls.dispose();
          built.dispose();
        },
      };
    },
    [model, spin, interactive, reduceMotion],
  );

  return <div ref={containerRef} className="h-full w-full" />;
}

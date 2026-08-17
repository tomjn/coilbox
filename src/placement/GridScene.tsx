/**
 * Flat ground with a build grid on it, in the shape the map preview hands out
 * (issue #1416).
 *
 * The blueprint editor draws on this instead of a map. It builds the same
 * {@link MapScene3D} the terrain preview does, so everything that draws on a
 * map, the unit models, the footprint squares, the selection plate and the
 * pointer's own arithmetic, works here without knowing which of the two it is
 * standing on.
 *
 * It reads nothing off disk. No archive is scanned, no heightmap is fetched and
 * no engine is needed, which is the point: a layout is not made for one map, and
 * map loading is the slowest thing in coilbox.
 *
 * The texture is the engine's own build grid, one line per build square with a
 * heavier one every eight, so a layout is read against the squares it will
 * actually stand on rather than against nothing.
 */

import { useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { BUILD_SQUARE } from "@/blueprint/footprint";
import { useCanvas3D } from "@/lib/useCanvas3D";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";

/** Scene units the longer side is normalised to, the same figure the map
 *  preview uses, so the camera's limits mean the same thing on both. */
const BASE = 100;

/** How many build squares one repeat of the grid texture covers. */
const SQUARES_PER_TILE = 8;

/** How many pixels one build square takes in that texture. Enough that a line
 *  stays a line at a shallow angle, small enough that the whole tile is one
 *  cheap canvas. */
const PIXELS_PER_SQUARE = 32;

/** Ground, grid and heavy grid, as the dark theme wants them. */
const GROUND_HEX = "#1c2431";
const LINE_HEX = "rgba(148, 163, 184, 0.22)";
const HEAVY_HEX = "rgba(148, 163, 184, 0.45)";

/**
 * One tile of build grid, drawn once and repeated across the plane.
 *
 * Repeating a small canvas rather than drawing the whole grid as geometry keeps
 * a 4km square of ground to one draw call, and lets the mip chain fade the fine
 * lines out as the camera pulls back instead of aliasing them into moire.
 */
function buildGridTexture(): THREE.Texture {
  const size = SQUARES_PER_TILE * PIXELS_PER_SQUARE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = GROUND_HEX;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = LINE_HEX;
    ctx.lineWidth = 1;
    for (let at = 0; at <= size; at += PIXELS_PER_SQUARE) {
      ctx.beginPath();
      ctx.moveTo(at + 0.5, 0);
      ctx.lineTo(at + 0.5, size);
      ctx.moveTo(0, at + 0.5);
      ctx.lineTo(size, at + 0.5);
      ctx.stroke();
    }
    // The tile's own edges, heavier, so the eye has something to count by
    // without counting every square.
    ctx.strokeStyle = HEAVY_HEX;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * A square of flat ground to place buildings on.
 *
 * `extent` is how many elmos it is across, which is what the surface's own
 * coordinates are measured in. The scene it builds is handed over the same way
 * the map preview hands its own over, and withdrawn the same way.
 */
export function GridScene({
  extent,
  className,
  onScene,
}: {
  extent: number;
  className?: string;
  /** Handed the built scene, and null when it is torn down. */
  onScene?: (handle: MapScene3D | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Read at hand-over time rather than captured, so an inline callback neither
  // rebuilds the scene nor is called back stale.
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;

  useCanvas3D(
    hostRef,
    ({ renderer, resize: fitCanvas }) => {
      if (extent <= 0) return;

      const scale = BASE / extent;
      const plane = extent * scale;

      const scene = new THREE.Scene();
      const texture = buildGridTexture();
      texture.repeat.set(
        extent / (BUILD_SQUARE * SQUARES_PER_TILE),
        extent / (BUILD_SQUARE * SQUARES_PER_TILE),
      );

      const geometry = new THREE.PlaneGeometry(plane, plane);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1,
        metalness: 0,
      });
      scene.add(new THREE.Mesh(geometry, material));

      // Enough fill that a model's underside is not black, and one raking light
      // so its shape reads. Nothing map-derived, because there is no map.
      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
      sun.position.set(BASE * 0.5, BASE * 0.9, BASE * 0.35);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.position.set(0, BASE * 0.7, BASE * 1.0);
      const fitCamera = (width: number, height: number) => {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.target.set(0, 0, 0);
      controls.minDistance = BASE * 0.02;
      controls.maxDistance = BASE * 3;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.zoomToCursor = true;

      // A hair above the ground, so a top-down view cannot end up under it.
      const floor = BASE * 0.005;
      const render = () => {
        if (camera.position.y < floor) camera.position.y = floor;
        renderer.render(scene, camera);
      };
      controls.addEventListener("change", render);
      renderer.setClearColor(0x000000, 0);

      fitCanvas();
      let handedOver = false;
      if (onSceneRef.current) {
        handedOver = true;
        onSceneRef.current({
          scene,
          camera,
          controls,
          renderer,
          render,
          scale,
          planeWidth: plane,
          planeDepth: plane,
        });
      }

      return {
        render,
        resize: fitCamera,
        dispose: () => {
          // Withdrawn first, so whoever put things on this scene drops them
          // before the scene itself goes.
          if (handedOver) onSceneRef.current?.(null);
          controls.removeEventListener("change", render);
          controls.dispose();
          geometry.dispose();
          material.dispose();
          texture.dispose();
        },
      };
    },
    [extent],
  );

  return <div ref={hostRef} className={className} />;
}

/**
 * The unit builder's axis compass, in the top right of the viewport.
 *
 * It shows which way the world's axes point from where the camera is, and each
 * end of each axis is a button that turns the camera to look from that end:
 * the +x end to the side, +y to the top and +z to the front, with -x, -y and -z
 * to the other side, the bottom and the back. The middle button resets the view.
 * A drag anywhere on it turns the camera, as the view navigation gizmos of
 * other 3D tools do.
 *
 * The ends are HTML buttons rather than parts of the drawing, so each has a
 * name, takes Tab and shows a focus ring. They move every frame while the
 * camera orbits, so `paintCompass` writes their positions straight into the
 * page from the render loop rather than through React state.
 */

import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { type RefObject, useRef } from "react";
import * as THREE from "three";
import type { StandardView } from "../../orthoViews";
import { useShortcutOverrides } from "../../shortcutOverridesStore";
import { shortcutLabel } from "../../shortcuts";
import {
  AXES,
  COMPASS_ENDS,
  COMPASS_MID,
  COMPASS_SIZE,
  compassEnds,
} from "./compassLayout";

const AXIS_COLOURS = { x: "#f87171", y: "#4ade80", z: "#60a5fa" } as const;

export interface AxisCompassProps {
  /** The element `paintCompass` moves the ends of. */
  compassRef: RefObject<HTMLFieldSetElement | null>;
  /** Which standard view the camera is in, if any. */
  view: StandardView | null;
  /** Asked for when an axis end is pressed. */
  onView: (view: StandardView) => void;
  onResetView: () => void;
  /** A drag across the compass, in pixels since the last call. */
  onOrbit: (dx: number, dy: number) => void;
}

/** How far a press moves before it is a drag rather than a click, as the
 *  piece tree has it. */
const DRAG_THRESHOLD = 4;

/**
 * Move the compass's ends and lines to match where the camera is looking.
 *
 * Painted straight into the page from the render loop rather than through React
 * state: the camera moves every frame while orbiting, and re-rendering the tree
 * sixty times a second to move six buttons would be absurd.
 */
export function paintCompass(root: HTMLElement, camera: THREE.Camera) {
  const basis = new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse);
  const point = new THREE.Vector3();
  const seen = {} as Record<(typeof AXES)[number], [number, number, number]>;
  for (const axis of AXES) {
    point.set(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
    point.applyMatrix3(basis);
    seen[axis] = [point.x, point.y, point.z];
  }

  const ends = compassEnds(seen);
  for (const end of ends) {
    const button = root.querySelector<HTMLElement>(`[data-end="${end.id}"]`);
    if (!button) continue;
    button.style.left = `${end.x}px`;
    button.style.top = `${end.y}px`;
    // An end pointing away from the camera is drawn faint, so the near end of
    // each pair is the readable one. Still a button: only its look changes.
    button.style.opacity = String(0.45 + end.towards * 0.55);
    button.style.zIndex = String(1 + Math.round(end.towards * 10));
  }
  for (const axis of AXES) {
    const line = root.querySelector(`[data-axis="${axis}"]`);
    const from = ends.find((end) => end.id === `${axis}-`);
    const to = ends.find((end) => end.id === `${axis}+`);
    if (!line || !from || !to) continue;
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
  }
}

export function AxisCompass({
  compassRef,
  view,
  onView,
  onResetView,
  onOrbit,
}: AxisCompassProps) {
  const { t } = useLingui();
  // A press anywhere on the compass, the ends included, turns the camera once
  // it moves past the threshold. Until then it may still be a click on an end,
  // so the pointer is only captured once it is a drag: captured from the
  // start, the click would land on the compass and never reach the end.
  const press = useRef<{
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const dragged = useRef(false);
  // Re-render when a shortcut is rebound, so its tooltip keeps up.
  useShortcutOverrides();
  const front = shortcutLabel("view-front");
  const side = shortcutLabel("view-side");
  const top = shortcutLabel("view-top");
  const names: Record<(typeof COMPASS_ENDS)[number]["id"], string> = {
    "x+": t`X: look at the side with no perspective (${side})`,
    "x-": t`Minus X: look at the other side with no perspective`,
    "y+": t`Y: look at the top with no perspective (${top})`,
    "y-": t`Minus Y: look at the bottom with no perspective`,
    "z+": t`Z: look at the front with no perspective (${front})`,
    "z-": t`Minus Z: look at the back with no perspective`,
  };

  return (
    <fieldset
      ref={compassRef}
      aria-label={t`View axes`}
      title={t`Drag to turn the view`}
      className="pointer-events-auto relative m-0 min-w-0 shrink-0 cursor-grab touch-none rounded-full border-0 bg-background/60 p-0 backdrop-blur active:cursor-grabbing"
      style={{ width: COMPASS_SIZE, height: COMPASS_SIZE }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragged.current = false;
        press.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          dragging: false,
        };
      }}
      onPointerMove={(event) => {
        const held = press.current;
        if (!held || held.id !== event.pointerId) return;
        if (!held.dragging) {
          const moved = Math.hypot(
            event.clientX - held.startX,
            event.clientY - held.startY,
          );
          if (moved < DRAG_THRESHOLD) return;
          held.dragging = true;
          dragged.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        onOrbit(event.clientX - held.x, event.clientY - held.y);
        held.x = event.clientX;
        held.y = event.clientY;
      }}
      onPointerUp={() => {
        press.current = null;
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      // A drag that started on an end is not a press of that end.
      onClickCapture={(event) => {
        if (!dragged.current) return;
        dragged.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <svg
        viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
        className="absolute inset-0 size-full"
        aria-hidden
        role="presentation"
      >
        {AXES.map((axis) => (
          <line
            key={axis}
            data-axis={axis}
            x1={COMPASS_MID}
            y1={COMPASS_MID}
            x2={COMPASS_MID}
            y2={COMPASS_MID}
            stroke={AXIS_COLOURS[axis]}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
      </svg>
      {COMPASS_ENDS.map((end) => (
        <Button
          key={end.id}
          type="button"
          variant="outline"
          size="icon"
          data-end={end.id}
          aria-label={names[end.id]}
          title={names[end.id]}
          aria-current={view === end.view ? "true" : undefined}
          onClick={() => onView(end.view)}
          className={cn(
            "absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full p-0 text-xs font-semibold",
            end.sign < 0 && "bg-background/40",
            view === end.view && "bg-primary/20",
          )}
          style={{
            left: COMPASS_MID,
            top: COMPASS_MID,
            color: AXIS_COLOURS[end.axis],
            borderColor: AXIS_COLOURS[end.axis],
          }}
        >
          {end.sign > 0 ? (
            <span aria-hidden>{end.axis.toUpperCase()}</span>
          ) : (
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
          )}
        </Button>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={t`Reset the view`}
        title={t`Reset the view`}
        onClick={onResetView}
        className="absolute z-20 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full p-0"
        style={{ left: COMPASS_MID, top: COMPASS_MID }}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-foreground" />
      </Button>
    </fieldset>
  );
}

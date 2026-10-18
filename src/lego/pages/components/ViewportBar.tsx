/**
 * The unit builder's bar of view controls, in the bottom right of the viewport.
 *
 * Kept apart from the viewport so it can be rendered without a WebGL context:
 * everything it shows is a state the viewport owns and passes in. The pickers
 * that open a popover of their own come in as slots, because what they need to
 * do their job is the viewport's business, not the bar's.
 *
 * The front, side and top views are not in the bar. They open as a column
 * above the reset button when it is hovered or focused, which is where somebody
 * looking for a way to put the camera somewhere known already is.
 */

import {
  Bone,
  Crosshair,
  Cuboid,
  Eye,
  EyeOff,
  Footprints,
  Keyboard,
  Layers,
  type LucideIcon,
  PanelLeft,
  PanelTop,
  Radar,
  RulerDimensionLine,
  Scale,
  Scissors,
  Shield,
  Sparkles,
  Square,
  SquareDashed,
  SquaresIntersect,
  Target,
  Video,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { ButtonGroup } from "@/components/ui/button-group";
import {
  GridToggle,
  ViewButton,
  ViewControls,
  ViewToggle,
} from "@/components/ViewControls";
import type { StandardView } from "../../orthoViews";
import { shortcutLabel } from "../../shortcuts";
import type { DrawMode } from "./drawMode";

/** Something in the view that is either on or off. */
export interface Toggle {
  on: boolean;
  onChange: (on: boolean) => void;
}

export interface ViewportBarProps {
  /** The problems button, absent when the page has no checks to list. */
  problems?: ReactNode;
  grid: Toggle;
  drawMode: DrawMode;
  onNextDrawMode: () => void;
  collision: Toggle;
  /** Absent for a unit with no skeleton. */
  skeleton?: Toggle;
  balance: Toggle;
  overlap: Toggle;
  /** The footprint check, and whether the barrel and the like are left out of
   *  it. Absent hides both. */
  footprint?: Toggle & {
    leaveOut: boolean;
    onLeaveOutChange: (leaveOut: boolean) => void;
  };
  aim: Toggle;
  /** Absent for a unit with no weapon ranges to draw. */
  reach?: Toggle;
  /** Which of the front, side and top views is showing, if any. */
  view: StandardView | null;
  onView: (view: StandardView, on: boolean) => void;
  measure: Toggle;
  /** The pose list popover, absent where poses cannot be edited. */
  poses?: ReactNode;
  /** The guides popover, absent where guides cannot be edited. */
  guides?: ReactNode;
  /** Absent while there are no guides to hide. */
  guideVisibility?: Toggle;
  /** The backdrop and ground popover. */
  environment: ReactNode;
  /** The reference unit popover. */
  reference: ReactNode;
  /** Absent while the run has no stand-in. */
  standIn?: Toggle;
  /** Absent while the stand-in does not drive. */
  followDrive?: Toggle;
  /** Absent while the script has drawn no effect. */
  effects?: Toggle;
  onShortcuts: () => void;
  compassRef: RefObject<SVGSVGElement | null>;
  onResetView: () => void;
}

/** The face of the draw mode button, which is the mode the unit is in. */
const DRAW_MODE_ICONS: Record<DrawMode, LucideIcon> = {
  solid: Cuboid,
  wireframe: SquareDashed,
  both: Layers,
};

/** What pressing the button does from each mode, naming the mode it goes to. */
const DRAW_MODE_TITLES: Record<DrawMode, (key: string) => string> = {
  solid: (key) => `Draw the unit as edges (${key})`,
  wireframe: (key) => `Draw the unit solid with edges (${key})`,
  both: (key) => `Draw the unit solid (${key})`,
};

/** The front, side and top views, top to bottom as the flyout lists them. */
const VIEW_BUTTONS: { id: StandardView; icon: LucideIcon; label: string }[] = [
  { id: "front", icon: Square, label: "front" },
  { id: "side", icon: PanelLeft, label: "side" },
  { id: "top", icon: PanelTop, label: "top" },
];

export function ViewportBar({
  problems,
  grid,
  drawMode,
  onNextDrawMode,
  collision,
  skeleton,
  balance,
  overlap,
  footprint,
  aim,
  reach,
  view,
  onView,
  measure,
  poses,
  guides,
  guideVisibility,
  environment,
  reference,
  standIn,
  followDrive,
  effects,
  onShortcuts,
  compassRef,
  onResetView,
}: ViewportBarProps) {
  const DrawModeFace = DRAW_MODE_ICONS[drawMode];
  return (
    <ViewControls className="pointer-events-auto shrink-0">
      {problems}
      <GridToggle
        on={grid.on}
        onChange={grid.onChange}
        showTitle="Show the ground grid, marked in footprint steps and plate sizes"
      />
      <ViewButton
        title={DRAW_MODE_TITLES[drawMode](shortcutLabel("draw-mode"))}
        onClick={onNextDrawMode}
      >
        <DrawModeFace className="size-4" />
      </ViewButton>
      <ViewToggle
        icon={Shield}
        on={collision.on}
        onChange={collision.onChange}
        hideTitle="Hide the collision volume"
        showTitle="Show the collision volume, the shape the engine hits and clicks"
      />
      {skeleton ? (
        <ViewToggle
          icon={Bone}
          on={skeleton.on}
          onChange={skeleton.onChange}
          hideTitle={`Hide the skeleton (${shortcutLabel("skeleton")})`}
          showTitle={`Show the skeleton: a line from each bone to its parent, a dot on each joint and its role (${shortcutLabel("skeleton")})`}
        />
      ) : null}
      <ViewToggle
        icon={Scale}
        on={balance.on}
        onChange={balance.onChange}
        hideTitle="Hide the balance check"
        showTitle="Show the balance check: where the weight looks centred, against the ground the feet or wheels cover. An estimate from piece volumes at one density, not a mass. The engine does not simulate balance"
      />
      <ViewToggle
        icon={SquaresIntersect}
        on={overlap.on}
        onChange={overlap.onChange}
        hideTitle="Hide the overlap check"
        showTitle="Show the overlap check: outlines pieces buried wholly inside another piece, which the model still draws and the export still writes"
      />
      {footprint ? (
        <ViewToggle
          icon={Footprints}
          on={footprint.on}
          onChange={footprint.onChange}
          hideTitle="Hide the footprint check"
          showTitle="Show the footprint check: the footprint the export writes, drawn on the ground under the unit"
        />
      ) : null}
      {footprint?.on ? (
        <ViewToggle
          icon={Scissors}
          on={footprint.leaveOut}
          onChange={footprint.onLeaveOutChange}
          hideTitle="Count the barrel, muzzle flare, aim point and build nozzle in the base footprint"
          showTitle="Leave the barrel, muzzle flare, aim point and build nozzle out of the base footprint"
        />
      ) : null}
      <ViewToggle
        icon={Crosshair}
        on={aim.on}
        onChange={aim.onChange}
        hideTitle="Hide the aim point"
        showTitle="Show the aim point, the one point another unit shoots at"
      />
      {reach ? (
        <ViewToggle
          icon={Radar}
          on={reach.on}
          onChange={reach.onChange}
          hideTitle="Hide weapon ranges"
          showTitle="Show each weapon's stated range and firing arc"
        />
      ) : null}
      <ViewToggle
        icon={RulerDimensionLine}
        on={measure.on}
        onChange={measure.onChange}
        hideTitle={`Leave the measure tool (${shortcutLabel("measure")})`}
        showTitle={`Measure between two points (${shortcutLabel("measure")})`}
      />
      {poses}
      {guides}
      {guideVisibility ? (
        <ViewToggle
          icon={EyeOff}
          onIcon={Eye}
          on={guideVisibility.on}
          onChange={guideVisibility.onChange}
          hideTitle="Hide the guides"
          showTitle="Show the guides"
        />
      ) : null}
      {environment}
      {reference}
      {standIn ? (
        <ViewToggle
          icon={Target}
          on={standIn.on}
          onChange={standIn.onChange}
          hideTitle="Hide the stand-in unit"
          showTitle="Show the stand-in unit, the thing a scenario aims at, builds or carries"
        />
      ) : null}
      {followDrive ? (
        <ViewToggle
          icon={Video}
          on={followDrive.on}
          onChange={followDrive.onChange}
          hideTitle="Keep the camera still while the unit drives"
          showTitle="Follow the driving unit with the camera"
        />
      ) : null}
      {effects ? (
        <ViewToggle
          icon={Sparkles}
          on={effects.on}
          onChange={effects.onChange}
          hideTitle="Hide script effects"
          showTitle="Show script effects, such as nano spray, from the unit's own script"
        />
      ) : null}
      <ViewButton title="Keyboard shortcuts (?)" onClick={onShortcuts}>
        <Keyboard className="size-4" />
      </ViewButton>
      <ViewsFlyout view={view} onView={onView}>
        <AxisCompass svgRef={compassRef} onClick={onResetView} />
      </ViewsFlyout>
    </ViewControls>
  );
}

/**
 * The reset button, with the fixed views in a column above it while it is
 * hovered or focused.
 *
 * A positioned group of the bar's own buttons rather than the registry
 * popover: a Radix popover opens on click, and the click here already resets
 * the view. Its content is also portalled to the end of the page, so Tab from
 * the reset button would never reach it. Here the views follow the reset
 * button in the page, so Tab moves into them, and the arrow keys move up and
 * down the column.
 */
function ViewsFlyout({
  view,
  onView,
  children,
}: {
  view: StandardView | null;
  onView: (view: StandardView, on: boolean) => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Escape closes it until the pointer or the focus next arrives.
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;

  /** The reset button and the views, in the order they sit top to bottom. */
  function column(): HTMLElement[] {
    const wrap = wrapRef.current;
    if (!wrap) return [];
    const reset = wrap.querySelector<HTMLElement>(":scope > button");
    const views = [
      ...wrap.querySelectorAll<HTMLElement>("[data-views-flyout] button"),
    ];
    return reset ? [...views, reset] : views;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      setDismissed(true);
      wrapRef.current?.querySelector<HTMLElement>(":scope > button")?.focus();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = column();
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const next = at + (event.key === "ArrowUp" ? -1 : 1);
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  }

  return (
    // The listeners are for the pointer and the keys arriving at the buttons
    // inside, which are what a keyboard or a screen reader reaches.
    // biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside are the interactive elements
    <div
      ref={wrapRef}
      className="relative flex [&>button]:rounded-l-none [&>button]:border-l-0"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) {
          setFocused(true);
          setDismissed(false);
        }
      }}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      onKeyDown={onKeyDown}
    >
      {children}
      {open ? (
        // Padding rather than a margin under the column, so the pointer
        // crossing from the reset button to a view never leaves the flyout.
        <div
          data-views-flyout
          className="absolute bottom-full left-0 z-10 pb-1"
        >
          <ButtonGroup orientation="vertical" aria-label="Fixed views">
            {VIEW_BUTTONS.map(({ id, icon, label }) => (
              <ViewToggle
                key={id}
                icon={icon}
                on={view === id}
                onChange={(on) => onView(id, on)}
                hideTitle={`Leave the ${label} view (${shortcutLabel(`view-${id}`)})`}
                showTitle={`Look at the ${label} with no perspective (${shortcutLabel(`view-${id}`)})`}
              />
            ))}
          </ButtonGroup>
        </div>
      ) : null}
    </div>
  );
}

const COMPASS_SIZE = 32;
const COMPASS_MID = COMPASS_SIZE / 2;
const COMPASS_ARM = 11;

/**
 * Which way the world's axes point from where the camera is.
 *
 * Painted straight into the SVG from the render loop rather than through React
 * state: the camera moves every frame while orbiting, and re-rendering the tree
 * sixty times a second to move three lines would be absurd.
 */
export function paintCompass(svg: SVGSVGElement, camera: THREE.Camera) {
  const basis = new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse);
  const point = new THREE.Vector3();

  for (const [axis, x, y, z] of [
    ["x", 1, 0, 0],
    ["y", 0, 1, 0],
    ["z", 0, 0, 1],
  ] as const) {
    point.set(x, y, z).applyMatrix3(basis);
    const line = svg.querySelector(`[data-axis="${axis}"]`);
    const label = svg.querySelector(`[data-label="${axis}"]`);
    // Screen y grows downward, so the camera-space y is negated.
    const tipX = COMPASS_MID + point.x * COMPASS_ARM;
    const tipY = COMPASS_MID - point.y * COMPASS_ARM;
    line?.setAttribute("x2", String(tipX));
    line?.setAttribute("y2", String(tipY));
    label?.setAttribute("x", String(tipX));
    label?.setAttribute("y", String(tipY));
    // An axis pointing away from the camera is drawn faint, so the near end of
    // each pair is the readable one.
    const towards = (point.z + 1) / 2;
    line?.setAttribute("opacity", String(0.35 + towards * 0.65));
    label?.setAttribute("opacity", String(0.35 + towards * 0.65));
  }
}

/**
 * The three world axes as seen from here, and a click to face front again.
 *
 * The builder's own `ResetViewButton`, and richer than the plain one: it
 * frames the unit like any reset, and while it waits it says which way round the
 * camera is, which is how somebody notices they are lost in the first place. It
 * is still one of the bar's buttons, so it is drawn as one.
 */
function AxisCompass({
  svgRef,
  onClick,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  onClick: () => void;
}) {
  return (
    <ViewButton title="Reset the view" onClick={onClick}>
      {/* A `size-` class of its own, or the button's own icon rule shrinks any
          bare svg to 16px and the compass becomes a smudge. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
        className="size-7"
        aria-hidden
        role="presentation"
      >
        {(
          [
            ["x", "#f87171"],
            ["y", "#4ade80"],
            ["z", "#60a5fa"],
          ] as const
        ).map(([axis, colour]) => (
          <g key={axis}>
            <line
              data-axis={axis}
              x1={COMPASS_MID}
              y1={COMPASS_MID}
              x2={COMPASS_MID}
              y2={COMPASS_MID}
              stroke={colour}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <text
              data-label={axis}
              x={COMPASS_MID}
              y={COMPASS_MID}
              fill={colour}
              fontSize={9}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {axis.toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
    </ViewButton>
  );
}

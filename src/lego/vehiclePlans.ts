/**
 * The wheeled and tracked body plans (issue #3250).
 *
 * Every wheel is a bone with the `wheel` role, which is what Wheels turning
 * (`wheels.roll`) spins about its local x axis, so the wheels turn in the
 * scenario preview before the unit has any parts. A wheel bone sits on its
 * axle with no pivot and no rotation: a part hung on it turns about the
 * part's own middle, which is where the pack centres every part, and its x
 * axis is the unit's x axis. The left wheels are on +x, the unit's left, and
 * each right bone is its left twin with x negated.
 *
 * Where the numbers come from. Both were measured off every model's `.s3o`
 * pieces, rest positions and vertices.
 *
 * Wheeled is Splinter Faction, the default game. Its 32 wheeled models in
 * `Objects3D` (not the chickens, not the parts folder) carry each axle as one
 * piece holding both wheels. The median model has 2 axles, so the defaults are
 * the medians of the 18 two axle models: axle spacing 19.55, track width
 * between the two wheels' middles 27.98, and wheel middle above the ground
 * 4.7, each to the 0.1 elmo step. Each range covers all 32 models, rounded
 * out to 5 elmos as the legged plans' are, except that the shortest axle
 * spacing (3.0) and the lowest wheel (1.5) are rounded out to whole elmos,
 * since 0 would put two axles in one place or a wheel's middle on the ground.
 * The axles run 2 to 5.
 *
 * Splinter Faction has no tracked model to measure. No piece outside its parts
 * folder is named track or tread, and its tank models (elighttank4,
 * emediumtank3, eheavytank4, eriottank3, eartytank2) carry the tread inside
 * the hull and are named by no unit definition. Tracked is Spring 1944 2.31
 * instead, whose tanks have a track piece and a piece for each pair of road
 * wheels. Its 44 tracked models (half tracks and trucks, whose wheels run past
 * the track, left out) give the medians: track length 47.41, track width
 * between the two tracks' middles 18.26, track height 8.82, and 6 road wheels
 * a side. The ranges are rounded out to 5 elmos, and the road wheels run 3 to
 * 11. Spring 1944 models its tanks smaller than Splinter Faction models its
 * wheeled units: a track width of 18.3 against 28.
 * The first to last road wheel distance is a median 0.65 of the track's
 * length, and a road wheel's middle is a median 0.34 of the track's height
 * above the ground.
 */

import { t } from "@lingui/core/macro";
import type { BodyPlan, BodyPlanBone, BodyPlanProportion } from "./bodyPlans";
import { between, type Joints, mean, spacingAlongZ } from "./planMeasure";

/** How much of a track's length lies between its first and last road wheel. */
const ROAD_WHEEL_SPAN = 0.65;
/** How high a road wheel's middle is, as a share of the track's height. */
const ROAD_WHEEL_HEIGHT = 0.34;

function proportion(
  id: string,
  label: () => string,
  unit: BodyPlanProportion["unit"],
  min: number,
  max: number,
  fallback: number,
  handle?: BodyPlanProportion["handle"],
): BodyPlanProportion {
  return {
    id,
    get label() {
      return label();
    },
    unit,
    min,
    max,
    step: unit === "count" ? 1 : 0.1,
    fallback,
    ...(handle ? { handle } : {}),
  };
}

/** The root on the ground and the body above it, which the wheels hang from. */
function chassis(height: number): BodyPlanBone[] {
  return [
    { id: "base", name: "base", parent: null, position: [0, 0, 0] },
    {
      id: "body",
      name: "body",
      parent: "base",
      position: [0, height, 0],
      role: "base",
    },
  ];
}

type Side = "l" | "r";

/** A bone on each side, the right one at the left one's x negated, each the
 *  other's twin. */
function bothSides(
  make: (side: Side, sign: 1 | -1) => Omit<BodyPlanBone, "twin">,
): BodyPlanBone[] {
  const left = make("l", 1);
  const right = make("r", -1);
  return [
    { ...left, twin: right.id },
    { ...right, twin: left.id },
  ];
}

/** The wheel bones of each axle or road wheel position, front first. */
function wheelRows(count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [
    `wheel.l${i + 1}`,
    `wheel.r${i + 1}`,
  ]);
}

/** The mean distance between the left and right wheel of each row. */
function widthAcross(joints: Joints, count: number) {
  return mean(wheelRows(count).map(([l, r]) => between(joints, l, r)));
}

/** The mean height of the picked wheel joints above the unit's origin, which
 *  is on the ground. */
function wheelY(joints: Joints, count: number) {
  return mean(
    wheelRows(count)
      .flat()
      .map((id) => joints.get(id)?.[1]),
  );
}

/** Where wheel `i` of `count` sits along z, front first, `spacing` apart. */
function along(i: number, count: number, spacing: number): number {
  return ((count - 1) / 2 - i) * spacing;
}

export const WHEELED: BodyPlan = {
  id: "wheeled",
  get label() {
    return t`Wheels`;
  },
  get description() {
    return t`A body on axles of wheels that turn while it moves.`;
  },
  proportions: [
    proportion("axles", () => t`Axles`, "count", 2, 5, 2),
    proportion("axleSpacing", () => t`Axle spacing`, "elmo", 3, 75, 19.6, {
      bone: "wheel.l1",
      axis: 2,
    }),
    proportion("trackWidth", () => t`Track width`, "elmo", 5, 100, 28, {
      bone: "wheel.l1",
      axis: 0,
    }),
    proportion("wheelHeight", () => t`Wheel height`, "elmo", 1, 20, 4.7, {
      bone: "body",
      axis: 1,
    }),
  ],
  bones({ axles, axleSpacing, trackWidth, wheelHeight }) {
    const count = axles as number;
    const half = (trackWidth as number) / 2;
    const bones = chassis(wheelHeight as number);
    for (let i = 0; i < count; i++) {
      const z = along(i, count, axleSpacing as number);
      bones.push(
        ...bothSides((side, sign) => ({
          id: `wheel.${side}${i + 1}`,
          name: `${side}wheel${i + 1}`,
          parent: "body",
          position: [sign * half, 0, z],
          role: "wheel",
        })),
      );
    }
    return bones;
  },
  presets: [{ presetId: "wheels.roll", params: {} }],
  // The axle count is chosen, and the rest is read off the wheels.
  measure(joints, { axles }) {
    const count = axles as number;
    return {
      axleSpacing: spacingAlongZ(joints, wheelRows(count)),
      trackWidth: widthAcross(joints, count),
      wheelHeight: wheelY(joints, count),
    };
  },
};

/**
 * Each side's track is a bone with the track role, at the middle of the track.
 * It is the place to hang the tread, and that side's road wheels hang off it.
 * The road wheels turn and the tread does not, and the balance check counts
 * the tread as what the unit stands on.
 */
export const TRACKED: BodyPlan = {
  id: "tracked",
  get label() {
    return t`Tracks`;
  },
  get description() {
    return t`A body on two tracks, with road wheels that turn while it moves.`;
  },
  proportions: [
    proportion("trackLength", () => t`Track length`, "elmo", 25, 65, 47.4, {
      bone: "wheel.l1",
      axis: 2,
    }),
    proportion("trackWidth", () => t`Track width`, "elmo", 10, 25, 18.3, {
      bone: "track.l",
      axis: 0,
    }),
    proportion("trackHeight", () => t`Track height`, "elmo", 5, 15, 8.8, {
      bone: "body",
      axis: 1,
    }),
    proportion("roadWheels", () => t`Road wheels a side`, "count", 3, 11, 6),
  ],
  bones({ trackLength, trackWidth, trackHeight, roadWheels }) {
    const count = roadWheels as number;
    const height = trackHeight as number;
    const half = (trackWidth as number) / 2;
    const spacing = ((trackLength as number) * ROAD_WHEEL_SPAN) / (count - 1);
    const wheelY = height * ROAD_WHEEL_HEIGHT - height / 2;
    const bones = [
      ...chassis(height / 2),
      ...bothSides((side, sign) => ({
        id: `track.${side}`,
        name: `${side}track`,
        parent: "body",
        position: [sign * half, 0, 0],
        role: "track",
      })),
    ];
    for (let i = 0; i < count; i++) {
      const z = along(i, count, spacing);
      bones.push(
        ...bothSides((side) => ({
          id: `wheel.${side}${i + 1}`,
          name: `${side}wheel${i + 1}`,
          parent: `track.${side}`,
          position: [0, wheelY, z],
          role: "wheel",
        })),
      );
    }
    return bones;
  },
  presets: [{ presetId: "wheels.roll", params: {} }],
  /**
   * The road wheel count is chosen. The plan puts its first and last road
   * wheel `ROAD_WHEEL_SPAN` of the track apart and each track bone at the
   * track's middle height, so those give the track's length and height. The
   * width is between the two tracks, or between the road wheels of a pair
   * when no track was picked.
   */
  measure(joints, { roadWheels }) {
    const count = roadWheels as number;
    const spacing = spacingAlongZ(joints, wheelRows(count));
    const trackY = mean(
      ["track.l", "track.r"].map((id) => joints.get(id)?.[1]),
    );
    const wheel = wheelY(joints, count);
    return {
      trackLength:
        spacing === undefined
          ? undefined
          : (spacing * (count - 1)) / ROAD_WHEEL_SPAN,
      trackWidth:
        between(joints, "track.l", "track.r") ?? widthAcross(joints, count),
      trackHeight:
        trackY !== undefined
          ? trackY * 2
          : wheel === undefined
            ? undefined
            : wheel / ROAD_WHEEL_HEIGHT,
    };
  },
};

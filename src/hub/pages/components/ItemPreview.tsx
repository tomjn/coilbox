import { useMemo } from "react";
import { LayoutPlan } from "@/blueprint/LayoutPlan";
import type { RunNodeType } from "@/runlite/model";
import { useHeldUnitPictures } from "../../assets/useUnitPictures";
import type {
  BlueprintShape,
  GalaxyShape,
  HubPreview,
  PreviewStat,
  RunShape,
} from "../../preview";
import { SetupPackContents } from "./SetupPackContents";

/**
 * What a hub item looks like, drawn from the container the item page fetched.
 *
 * Everything here is decided in `../../preview.ts`, which reads the payload. This
 * file only draws, so a kind that gains a preview needs a reader and a branch
 * here and nothing else.
 *
 * A preset is its composition, a pack is its contents, a conquest challenge is
 * its galaxy, a warpath challenge is its run, and a scenario is how much there
 * is of it. Nothing is fetched to draw any of that and no picture is stored
 * anywhere, with one exception: a pack of maps is drawn as its maps, and a
 * picture of a map has to be looked for. That is `./SetupPackContents.tsx`,
 * kept in its own file for the same reason.
 */
export function ItemPreview({ preview }: { preview: HubPreview }) {
  if (preview.kind === "preset") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {preview.teams.map((team, index) => (
            // The separator trails the team it follows, inside the same flex
            // item, rather than leading the team after it. A wrap always breaks
            // between items, so a leading separator can start a line on its own
            // and read as a stray character.
            <div key={team.allyTeam} className="flex items-stretch gap-2">
              <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3">
                {team.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: m.color }}
                    />
                    <span>{m.label}</span>
                    {m.side && (
                      <span className="text-muted-foreground">{m.side}</span>
                    )}
                  </div>
                ))}
              </div>
              {index < preview.teams.length - 1 && (
                <span className="self-center text-xs text-muted-foreground">
                  v
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {preview.playing} playing across {preview.teams.length}{" "}
          {preview.teams.length === 1 ? "team" : "teams"}
        </p>
      </div>
    );
  }

  if (preview.kind === "challenge") {
    return (
      <div className="flex flex-col gap-3">
        {preview.galaxy && <Galaxy shape={preview.galaxy} />}
        {preview.run && <RunMap shape={preview.run} />}
        <Stats stats={preview.stats} />
      </div>
    );
  }

  if (preview.kind === "blueprint") {
    return <BlueprintLayout shape={preview.layout} game={preview.game} />;
  }

  if (preview.kind === "setup-pack") {
    return <SetupPackContents pack={preview} />;
  }

  return <Stats stats={preview.stats} />;
}

/** The facts a preview could read, in a grid. */
function Stats({ stats }: { stats: PreviewStat[] }) {
  return (
    <dl className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="text-sm">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A shared layout, as a plan on a build grid.
 *
 * The drawing is `@/blueprint/LayoutPlan`, the same one the library card makes
 * of a layout on this machine, and the website makes of the same container. All
 * this adds is the size it is drawn at, the line under it, and the pictures of the
 * units it names, because a page has room to say what the picture cannot.
 *
 * The pictures are a lookup, which is the exception this file's own note describes.
 * Coilbox drew and uploaded them in the first place (`../../assets/renderTop.ts`),
 * so a layout for a game somebody has opened before is drawn as its buildings here
 * exactly as it is on the website.
 */
function BlueprintLayout({
  shape,
  game,
}: {
  shape: BlueprintShape;
  game: string | null;
}) {
  const buildings = shape.squares.length;
  const defs = useMemo(
    () => shape.squares.map((square) => square.def),
    [shape],
  );
  const pictures = useHeldUnitPictures(game, defs);

  return (
    <div className="flex flex-col gap-3">
      <LayoutPlan
        shape={shape}
        pictures={pictures}
        // A sheet of fixed proportions rather than a box the shape of the base.
        // A base can be a long thin wall or a tall narrow column, and either one
        // at the column's full width is a shape nobody can take in at a glance.
        className="mx-auto aspect-[4/3] w-full max-w-md"
      />
      <p className="text-xs text-muted-foreground">
        {buildings} {buildings === 1 ? "building" : "buildings"}
        {shape.ordered ? ", in build order" : ""}
      </p>
    </div>
  );
}

/** Territory no faction holds. Dimmer than any faction, so held space reads
 * first. */
const UNCLAIMED = "#6b7280";

/** One galaxy is drawn per page, so a fixed filter id is safe. */
const GLOW = "hub-preview-system-glow";

/**
 * The galaxy itself.
 *
 * Drawn rather than described because it is the thing a person would recognise.
 * Systems sit where the generator puts them, lanes are the jumps between them,
 * and colour is who holds what on turn one. Nothing else is drawn: the names and
 * maps come from installed content, which a galaxy rebuilt from a seed alone
 * does not have.
 *
 * The `viewBox` is the unit square the shape was fitted to, scaled up and inset
 * so a system at the edge is not clipped by its own glow.
 *
 * Exported so `BrowseCardArt.tsx` can draw the same galaxy at card size
 * (issue #2598): one renderer, sized by `className` rather than duplicated.
 */
export function Galaxy({
  shape,
  className = "mx-auto w-full max-w-md",
}: {
  shape: GalaxyShape;
  // Capped rather than full width by default. The shape is square, so at the
  // column's own width it would be taller than the screen and read as a chart
  // rather than a picture of the thing being shared. A card's fixed box calls
  // for a different fit, so the caller can override it.
  className?: string;
}) {
  const inset = 4;
  const scale = 100 - inset * 2;
  const at = (v: number) => inset + v * scale;
  const colorOf = (faction: number | null) =>
    faction === null ? UNCLAIMED : (shape.factionColors[faction] ?? UNCLAIMED);
  const held = shape.systems.filter((s) => s.faction !== null).length;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={`${shape.systems.length} systems joined by ${shape.lanes.length} jump lanes, ${held} of them held at the start`}
    >
      <defs>
        {/* Each node is a star, so it glows. The blurred copies go under the
            original rather than replacing it, which keeps a hard point of light
            in a soft halo instead of a smudge. */}
        <filter id={GLOW} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={1.6} result="halo" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="halo" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {shape.lanes.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={at(shape.systems[a].x)}
          y1={at(shape.systems[a].y)}
          x2={at(shape.systems[b].x)}
          y2={at(shape.systems[b].y)}
          stroke="currentColor"
          strokeWidth={0.4}
          className="text-border"
        />
      ))}
      <g filter={`url(#${GLOW})`}>
        {shape.systems.map((system) => (
          <circle
            key={system.id}
            cx={at(system.x)}
            cy={at(system.y)}
            // A capital is a brighter, bigger star. The glow does the rest of
            // the work, so it needs no ring to stand out.
            r={system.capital ? 2.1 : 1.2}
            fill={colorOf(system.faction)}
          />
        ))}
      </g>
    </svg>
  );
}

/** What each kind of stop on a run is, in the order it reads on the map.
 * Colours match the hub website's drawing of the same run
 * (`lib/gallery/warpathRun.ts` in tomjn/coilbox-hub), so a challenge looks the
 * same wherever it is opened. */
const RUN_NODE_KINDS: { type: RunNodeType; label: string; color: string }[] = [
  { type: "start", label: "Start", color: "#e5e5e5" },
  { type: "battle", label: "Battle", color: "#2f7dff" },
  { type: "elite", label: "Elite", color: "#ffb300" },
  { type: "event", label: "Event", color: "#a855f7" },
  { type: "reward", label: "Reward", color: "#00c853" },
  { type: "shop", label: "Depot", color: "#14b8a6" },
  { type: "boss", label: "Boss", color: "#ff3524" },
];

const RUN_COLORS = new Map(RUN_NODE_KINDS.map((k) => [k.type, k.color]));

/** One run map is drawn per page, so a fixed filter id is safe. */
const RUN_GLOW = "hub-preview-run-glow";

/**
 * A warpath run's route.
 *
 * Read left to right: the start is on the left, the boss is on the right and
 * largest, and the columns of two to four nodes a run branches through sit
 * between them, joined by forward routes. This is the same shape the hub
 * website draws for the same challenge (`lib/gallery/warpathRun.ts` in
 * tomjn/coilbox-hub) - a run's character is how many fights it makes you take
 * against how many chances to recover, which colour by node type is what
 * shows.
 *
 * Wide rather than square: a run is up to thirteen columns of at most four
 * nodes, and a square box would leave the route a thin line down the middle
 * of it.
 *
 * The legend costs seven lines of text, which reads fine once at item-page
 * size and would be smaller than anyone could read under a card-sized drawing,
 * so `legend` defaults to shown and `BrowseCardArt.tsx` turns it off.
 *
 * Exported so `BrowseCardArt.tsx` can draw the same run at card size.
 */
export function RunMap({
  shape,
  className = "mx-auto w-full max-w-md",
  legend = true,
}: {
  shape: RunShape;
  className?: string;
  legend?: boolean;
}) {
  const inset = 4;
  const atX = (v: number) => inset + v * (100 - inset * 2);
  const atY = (v: number) => inset + v * (40 - inset * 2);
  const kinds = RUN_NODE_KINDS.filter((k) =>
    shape.steps.some((s) => s.type === k.type),
  );
  const fights = shape.steps.filter(
    (s) => s.type === "battle" || s.type === "elite" || s.type === "boss",
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox="0 0 100 40"
        className={className}
        role="img"
        aria-label={`${shape.columns} stops from the start to the boss, ${shape.steps.length} nodes in all, ${fights} of them fights`}
      >
        <defs>
          <filter id={RUN_GLOW} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={1.1} result="halo" />
            <feMerge>
              <feMergeNode in="halo" />
              <feMergeNode in="halo" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {shape.routes.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={atX(shape.steps[a].x)}
            y1={atY(shape.steps[a].y)}
            x2={atX(shape.steps[b].x)}
            y2={atY(shape.steps[b].y)}
            stroke="currentColor"
            strokeWidth={0.3}
            className="text-border"
          />
        ))}
        <g filter={`url(#${RUN_GLOW})`}>
          {shape.steps.map((step) => (
            <circle
              key={step.id}
              cx={atX(step.x)}
              cy={atY(step.y)}
              r={step.type === "boss" ? 1.8 : 1.1}
              fill={RUN_COLORS.get(step.type) ?? UNCLAIMED}
            />
          ))}
        </g>
      </svg>
      {legend && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
          {kinds.map((kind) => (
            <li
              key={kind.type}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: kind.color }}
              />
              {kind.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

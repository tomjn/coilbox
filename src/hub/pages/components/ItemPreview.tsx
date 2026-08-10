import type { GalaxyShape, HubPreview, PreviewStat } from "../../preview";

/**
 * What a hub item looks like, drawn from the container the item page fetched.
 *
 * Everything here is decided in `../../preview.ts`, which reads the payload. This
 * file only draws, so a kind that gains a preview needs a reader and a branch
 * here and nothing else.
 *
 * Nothing is fetched to draw it and no picture is stored anywhere. A preset is
 * its composition, a pack is its contents, a conquest challenge is its galaxy,
 * and a scenario is how much there is of it.
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
        <Stats stats={preview.stats} />
      </div>
    );
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
 */
function Galaxy({ shape }: { shape: GalaxyShape }) {
  const inset = 4;
  const scale = 100 - inset * 2;
  const at = (v: number) => inset + v * scale;
  const colorOf = (faction: number | null) =>
    faction === null ? UNCLAIMED : (shape.factionColors[faction] ?? UNCLAIMED);
  const held = shape.systems.filter((s) => s.faction !== null).length;

  return (
    <svg
      viewBox="0 0 100 100"
      // Capped rather than full width. The shape is square, so at the column's
      // own width it would be taller than the screen and read as a chart rather
      // than a picture of the thing being shared.
      className="mx-auto w-full max-w-md"
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

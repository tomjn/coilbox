import { cn } from "@picoframe/frame";
import type { MapPicture } from "./picture";
import { mapPictureAlt } from "./picture";
import {
  type MissingMapPicture,
  placeholderBox,
  placeholderLabel,
  placeholderMeasure,
} from "./placeholder";
import { useMapPictureRung } from "./useMapPicture";

/**
 * A map, drawn from wherever a picture of it could be found (issue #1637).
 *
 * The ladder is `./picture.ts` and the demotion on a failed load is
 * `useMapPictureRung`, so all this does is put the answer on screen. It always
 * puts something there.
 *
 * Captioned only when a caller asks for it, with {@link label}. One map beside
 * the page that names it needs no caption, and a shelf of them does (issue
 * #1721). A captioned card says the name below the picture whichever rung filled
 * it, so the outline stands in for the picture alone rather than repeating in the
 * middle of the card what the caption says under it.
 */
export function MapPictureCard({
  mapName,
  ladder,
  className,
  label,
  detail,
}: {
  mapName: string;
  ladder: MapPicture[];
  /** Lands on the card, or on the figure round it when there is a caption, so a
   *  grid can make every card the height of its row. */
  className?: string;
  /** The name to caption the card with, for a screen showing several maps at
   *  once. */
  label?: string;
  /** A line under the name, for what is known about the map. See
   *  `./mapFacts.ts`. */
  detail?: string | null;
}) {
  const { picture, onError } = useMapPictureRung(ladder);
  const box =
    picture.from === "placeholder" ? (
      label ? (
        <MapOutline picture={picture} className="w-full" />
      ) : (
        <MapDrawing picture={picture} className={className} />
      )
    ) : (
      <div
        className={cn(
          "overflow-hidden rounded-md border border-border bg-muted",
          label ? "w-full" : className,
        )}
        // The picture's own proportions where the source knew them, and a square
        // otherwise. unitsync samples a map into a square texture, so a local
        // minimap has no proportions of its own to read.
        style={
          picture.width && picture.height
            ? { aspectRatio: `${picture.width} / ${picture.height}` }
            : { aspectRatio: "1 / 1" }
        }
      >
        <img
          src={picture.url}
          alt={mapPictureAlt(picture, mapName)}
          loading="lazy"
          onError={onError}
          className="size-full object-cover"
        />
      </div>
    );

  if (!label) return box;

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      {box}
      {/* Pushed to the bottom, so the captions in a row of different shaped maps
          line up with each other rather than with the end of each picture. */}
      <figcaption className="mt-auto flex flex-col gap-0.5 text-xs">
        <span className="break-all">{label}</span>
        {detail && <span className="text-muted-foreground">{detail}</span>}
      </figcaption>
    </figure>
  );
}

/** The stroke, in user units, so a non-scaling stroke is not clipped by the edge
 *  of the `viewBox`. */
const INSET = 2;

/** The corner, in user units. The box's longer side is always 100, so this is
 *  the same corner at every map size. */
const CORNER = 4;

/** How much colour the shape takes. Dashed and faint, because the shape is real
 *  and the picture is not. */
const FILL = 0.15;
const OUTLINE = 0.62;

/**
 * A map nothing has a picture of, drawn rather than fetched.
 *
 * The rung that cannot fail, and the one most maps in the hub browser reach
 * today, since the hub holds no minimaps until somebody runs the seed. It says
 * the map's name and the shape of the ground, which is most of what a reader can
 * be told without a photograph, and it reads as a deliberate absence rather than
 * as a picture that failed.
 *
 * Markup in the page and not a generated image, the same choice the hub makes at
 * `components/AssetPlaceholder.tsx`: the case this covers is the one where there
 * is nothing to fetch, so it must not cost a request.
 */
export function MapDrawing({
  picture,
  className,
}: {
  picture: MissingMapPicture;
  className?: string;
}) {
  const measure = placeholderMeasure(picture);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-4",
        className,
      )}
    >
      {/* Never blown up past a thumbnail. This is a stand-in, and a large one
          would draw more attention than the real pictures around it. */}
      <MapOutline picture={picture} className="w-full max-w-32" />
      <p className="flex flex-col items-center gap-0.5 text-center text-xs">
        <span className="break-all">{picture.name}</span>
        <span className="text-muted-foreground">
          {measure ?? "No picture of this map yet"}
        </span>
      </p>
    </div>
  );
}

/**
 * The shape of the ground on its own, at the map's own proportions.
 *
 * Shared with the captioned card above, which says the name under the picture and
 * so wants the outline where a picture would go rather than the whole card. Both
 * are the same drawing, so a map with no picture is the same shape on a grid of
 * them as it is on its own.
 */
function MapOutline({
  picture,
  className,
}: {
  picture: MissingMapPicture;
  className?: string;
}) {
  const box = placeholderBox(picture.size);

  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      className={cn("text-muted-foreground", className)}
      style={{ aspectRatio: `${box.width} / ${box.height}` }}
      role="img"
      aria-label={placeholderLabel(picture)}
    >
      <rect
        x={INSET}
        y={INSET}
        width={box.width - INSET * 2}
        height={box.height - INSET * 2}
        rx={CORNER}
        fill="currentColor"
        fillOpacity={FILL}
        stroke="currentColor"
        strokeOpacity={OUTLINE}
        // In pixels rather than user units, so a wide map and a square one get
        // the same hairline instead of one scaled by its own proportions.
        strokeWidth={1.25}
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

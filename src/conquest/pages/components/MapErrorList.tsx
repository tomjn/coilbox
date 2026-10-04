import type { HandmadeMapError } from "../../handmade/errors";

/** The reader's reasons a map folder was refused, in the author's terms. */
export function MapErrorList({ errors }: { errors: HandmadeMapError[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
      {errors.map((e) => (
        <li key={e.message}>{e.message}</li>
      ))}
    </ul>
  );
}

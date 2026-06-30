import type { ConfigOption } from "../../bindings";

/** Renders a map's or game's configuration options (name + description). */
export function OptionsList({
  options,
  title,
}: {
  options: ConfigOption[];
  title: string;
}) {
  if (options.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {title} ({options.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {options.map((o) => (
          <li
            key={o.key}
            className="rounded-lg border border-border/50 bg-card p-3"
          >
            <p className="text-sm font-medium">{o.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{o.key}</p>
            {o.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {o.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

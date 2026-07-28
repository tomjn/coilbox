import { Button, Input } from "@picoframe/frame";
import { Blocks, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import { PartPicker } from "./components/PartPicker";

type Status =
  | { state: "loading" }
  | { state: "ready"; pack: LoadedPack }
  | { state: "missing"; message: string };

/**
 * Browse the parts pack.
 *
 * Search covers the generated name, the tags and the original object names from
 * the source file, so a part is findable whether you know what it looks like or
 * where it came from.
 */
export default function PartsPage() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [colourway, setColourway] = useState<string | null>(null);
  const [selected, setSelected] = useState<LegoPartInfo | null>(null);

  useEffect(() => {
    let live = true;
    loadPack().then(
      (pack) => live && setStatus({ state: "ready", pack }),
      (error: unknown) =>
        live &&
        setStatus({
          state: "missing",
          message: String((error as Error).message ?? error),
        }),
    );
    return () => {
      live = false;
    };
  }, []);

  const pack = status.state === "ready" ? status.pack : null;

  const parts = useMemo(() => {
    if (!pack) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pack.parts.filter((part) => {
      if (colourway && part.colourway !== colourway) return false;
      if (terms.length === 0) return true;
      const haystack =
        `${part.name} ${part.tags.join(" ")} ${part.material} ${part.sourceNames.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [pack, query, colourway]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
          <Blocks size={18} /> Lego Parts
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          The pieces units are assembled from. Every one is already mapped to
          the same texture, so a unit built from them needs no UV work.
        </p>
      </header>

      {status.state === "loading" ? <Loading /> : null}
      {status.state === "missing" ? <Missing message={status.message} /> : null}

      {pack ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search parts"
              className="w-56"
              aria-label="Search parts"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={colourway === null ? "default" : "outline"}
                onClick={() => setColourway(null)}
              >
                All
              </Button>
              {pack.manifest.categories.map((category) => (
                <Button
                  key={category.id}
                  size="sm"
                  variant={colourway === category.id ? "default" : "outline"}
                  onClick={() => setColourway(category.id)}
                >
                  {category.label}
                </Button>
              ))}
            </div>
            <span className="ml-auto text-sm text-muted-foreground">
              {parts.length === pack.parts.length
                ? `${parts.length} parts`
                : `${parts.length} of ${pack.parts.length} parts`}
            </span>
          </div>

          {parts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nothing matches. Try a shape like "beam", a size like "tiny", or
              clear the search.
            </p>
          ) : (
            <PartPicker
              pack={pack}
              parts={parts}
              selectedId={selected?.id}
              onSelect={setSelected}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2 p-6">
      {Array.from({ length: 24 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton, nothing reorders
          key={i}
          className="h-[108px] animate-pulse rounded bg-muted"
        />
      ))}
    </div>
  );
}

function Missing({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <TriangleAlert className="text-muted-foreground" size={28} />
      <h2 className="text-base font-medium">No parts pack installed</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        Put a pack in <code>.coilbox/legoparts/</code> beside the executable, or
        reinstall to restore the bundled one. The format is documented in the
        Lego parts pack guide.
      </p>
      <p className="max-w-prose text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

import { Blocks, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { usePartFilter } from "../filter";
import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import { PartDetail } from "./components/PartDetail";
import { NoMatches, PartFilters } from "./components/PartFilters";
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
  const filter = usePartFilter(pack);
  const parts = filter.parts;

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
          <PartFilters
            pack={pack}
            query={filter.query}
            onQuery={filter.setQuery}
            colourway={filter.colourway}
            onColourway={filter.setColourway}
            shown={parts.length}
            className="border-b border-border px-6 py-3"
          />

          {parts.length === 0 ? (
            <NoMatches />
          ) : (
            <div className="flex min-h-0 flex-1">
              <PartPicker
                pack={pack}
                parts={parts}
                selectedId={selected?.id}
                onSelect={setSelected}
              />
              {selected ? (
                <PartDetail
                  pack={pack}
                  part={selected}
                  onSelect={setSelected}
                  onClose={() => setSelected(null)}
                />
              ) : null}
            </div>
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

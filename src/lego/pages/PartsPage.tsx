import { Button } from "@picoframe/frame";
import { Blocks, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { usePartFilter } from "../filter";
import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import { deleteCompound, saveCompound, useLegoCompounds } from "../projects";
import { CompoundPicker } from "./components/CompoundPicker";
import { PartDetail } from "./components/PartDetail";
import { NoMatches, PackProblems, PartFilters } from "./components/PartFilters";
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
  const [tab, setTab] = useState<"parts" | "compounds">("parts");
  const { compounds } = useLegoCompounds();

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
          <PackProblems pack={pack} />
          <div className="flex items-center gap-2 border-b border-border px-6 py-3">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={tab === "parts" ? "default" : "ghost"}
                onClick={() => setTab("parts")}
              >
                Parts
              </Button>
              <Button
                size="sm"
                variant={tab === "compounds" ? "default" : "ghost"}
                onClick={() => setTab("compounds")}
              >
                Compounds
              </Button>
            </div>
            {tab === "parts" ? (
              <PartFilters
                pack={pack}
                query={filter.query}
                onQuery={filter.setQuery}
                category={filter.category}
                onCategory={filter.setCategory}
                packId={filter.packId}
                onPackId={filter.setPackId}
                shown={parts.length}
                className="flex-1"
              />
            ) : (
              <span className="ml-auto text-sm text-muted-foreground">
                Assemblies you saved while building. Open a unit to use one.
              </span>
            )}
          </div>

          {tab === "compounds" ? (
            <div className="flex min-h-0 flex-1">
              <CompoundPicker
                pack={pack}
                compounds={compounds}
                onDelete={(id) => void deleteCompound(id)}
                onRename={(compound, name) =>
                  void saveCompound({ ...compound, name })
                }
              />
            </div>
          ) : parts.length === 0 ? (
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

import { ToyBrick, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useInventoryView } from "../inventory";
import { withLabels } from "../moduleFilter";
import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import { deleteCompound, saveCompound, useModules } from "../projects";
import type { ShapeKind } from "../shapes";
import { useModuleFiles } from "../useModuleFiles";
import { useSharedModuleImport, useShareModule } from "../useModuleShare";
import { InventoryFilters, InventoryGrids } from "./components/Inventory";
import { PartDetail, ShapeDetail } from "./components/PartDetail";
import { PackAtlases, PackProblems } from "./components/PartFilters";

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
  const [selectedShape, setSelectedShape] = useState<ShapeKind | null>(null);

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
  // The built in modules first, then the user's own.
  const compounds = useModules(pack);
  const moduleFiles = useModuleFiles(pack, compounds);
  const shareModule = useShareModule();
  useSharedModuleImport(pack, status.state !== "loading", compounds);
  const view = useInventoryView(pack, compounds);
  // The whole page scrolls as one, parts then modules (#4468), so the grids
  // scroll with this rather than in boxes of their own.
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col">
        <header className="border-b border-border px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <ToyBrick size={18} /> Lego Parts
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            The pieces a model can be assembled from. Every one is already
            mapped to the same texture, so a model built entirely from them
            needs no UV work.
          </p>
        </header>

        {status.state === "loading" ? <Loading /> : null}
        {status.state === "missing" ? (
          <Missing message={status.message} />
        ) : null}

        {pack ? (
          <>
            <PackProblems pack={pack} />
            <PackAtlases pack={pack} />
            <InventoryFilters
              onLoadModuleFile={moduleFiles.loadFile}
              view={view}
              pack={pack}
              compounds={compounds}
              className="border-b border-border px-6 py-3"
            />
            <InventoryGrids
              view={view}
              pack={pack}
              compounds={compounds}
              selectedPartId={selected?.id}
              onSelectPart={(part) => {
                setSelectedShape(null);
                setSelected(part);
              }}
              selectedShape={selectedShape?.id}
              onSelectShape={(shape) => {
                setSelected(null);
                setSelectedShape(shape);
              }}
              // Modules have no detail view yet, so choosing one closes whatever
              // the panel was showing rather than leaving it up.
              onSelectModule={() => {
                setSelected(null);
                setSelectedShape(null);
              }}
              onDeleteModule={(id) => void deleteCompound(id)}
              onRenameModule={(compound, name) =>
                void saveCompound({ ...compound, name })
              }
              onCopyModule={(compound) => void saveCompound(compound)}
              onSaveModuleFile={moduleFiles.saveFile}
              onShareModule={shareModule}
              onLabelsModule={(compound, labels) =>
                void saveCompound(withLabels(compound, labels))
              }
              aside={
                selectedShape ? (
                  <ShapeDetail
                    pack={pack}
                    shape={selectedShape}
                    onClose={() => setSelectedShape(null)}
                  />
                ) : selected ? (
                  <PartDetail
                    pack={pack}
                    part={selected}
                    onSelect={setSelected}
                    onClose={() => setSelected(null)}
                  />
                ) : null
              }
              scrollRoot={scrollRef}
            />
          </>
        ) : null}
      </div>
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

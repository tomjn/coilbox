import { Button } from "@picoframe/frame";
import { FileUp, ToyBrick } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/content/pages/components/states";

import { useInventoryView } from "../inventory";
import { withLabels } from "../moduleFilter";
import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import { deleteCompound, saveCompound, useModules } from "../projects";
import type { ShapeKind } from "../shapes";
import { useModuleFiles } from "../useModuleFiles";
import { useSharedModuleImport, useShareModule } from "../useModuleShare";
import { InventoryFilters, InventoryGrids } from "./components/Inventory";
import { PartDetail, ShapeDetail } from "./components/PartDetail";
import {
  PackAtlases,
  PackProblems,
  PackSelect,
} from "./components/PartFilters";
import { CELL, GAP, LABEL } from "./components/TileGrid";

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
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

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
      <div className="flex min-h-full flex-col gap-4 p-4">
        <PageHeader
          title={
            <>
              <ToyBrick size={18} /> Lego Parts
            </>
          }
          actions={
            pack ? (
              <>
                <PackSelect
                  pack={pack}
                  packId={view.partFilter.packId}
                  onPackId={view.partFilter.setPackId}
                  className="w-44"
                />
                <Button variant="outline" onClick={moduleFiles.loadFile}>
                  <FileUp size={16} /> Load from file
                </Button>
              </>
            ) : null
          }
        />

        {status.state === "loading" ? <Loading /> : null}
        {status.state === "missing" ? (
          <ErrorBanner message={`No parts pack installed: ${status.message}`} />
        ) : null}

        {pack ? (
          <>
            <PackProblems pack={pack} />
            <PackAtlases pack={pack} />
            <InventoryFilters
              view={view}
              pack={pack}
              compounds={compounds}
              showPacks={false}
            />
            <InventoryGrids
              view={view}
              pack={pack}
              compounds={compounds}
              selectedPartId={selected?.id}
              onSelectPart={(part) => {
                setSelectedShape(null);
                setSelectedModuleId(null);
                setSelected(part);
              }}
              selectedShape={selectedShape?.id}
              onSelectShape={(shape) => {
                setSelected(null);
                setSelectedModuleId(null);
                setSelectedShape(shape);
              }}
              // Modules have no detail view yet, so choosing one closes whatever
              // the panel was showing rather than leaving it up.
              onSelectModule={(module) => {
                setSelected(null);
                setSelectedShape(null);
                setSelectedModuleId(module.id);
              }}
              selectedModuleId={selectedModuleId ?? undefined}
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

/** The grid's own tile and gap, so nothing moves when it lands. */
function Loading() {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(auto-fill, ${CELL}px)`,
        columnGap: GAP,
        rowGap: GAP + LABEL,
      }}
    >
      {Array.from({ length: 24 }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton, nothing reorders
          key={i}
          className="rounded-md"
          style={{ height: CELL }}
        />
      ))}
    </div>
  );
}

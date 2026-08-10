import { Button, useDrawer } from "@picoframe/frame";
import { Download, Package2 } from "lucide-react";
import { useEffect } from "react";
import { useImportParam } from "../../deeplink/useImportParam";
import { useRecordHubImport } from "../../hub/imports";
import { usePlayReadiness } from "../../play/config";
import { presetRoute } from "../../play/presets";

/**
 * The Content → Setup packs page (issue #415): export the current engine,
 * game, chosen maps and optionally presets into a small pasteable code, or
 * import one shared by someone else. The Prism/mrpack pattern applied to
 * coilbox: references, not content, resolved through issue #387's
 * `ResolveContentGate` on import.
 */
export default function SetupPacksPage() {
  const { target, ready } = usePlayReadiness();
  const drawer = useDrawer();

  const openExport = async () => {
    if (!target) return;
    const { ExportPackForm } = await import("./components/ExportPackForm");
    drawer.open({
      title: "Export a setup pack",
      width: "26rem",
      content: <ExportPackForm target={target} />,
    });
  };

  // A confirmed `coilbox://import` deep link (issue #388) lands here with the
  // pack code in the query string, and with the hub item it came from alongside
  // it when the hub browse screen started it (issue #1368).
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();

  const openImport = async (initialCode?: string) => {
    const { ImportPackForm } = await import("./components/ImportPackForm");
    drawer.open({
      title: "Import a setup pack",
      width: "26rem",
      content: (
        <ImportPackForm
          initialCode={initialCode}
          // A pack leaves its bundled presets behind and nothing else, so those
          // are what says whether this one is still here. A pack with none
          // records no ids and reads as imported before, never as still here.
          //
          // Opening one therefore means opening the first preset it brought
          // (issue #1372). With none there is nothing to open, and the route is
          // never read because such a pack never reads as still here.
          onImported={(presetIds) =>
            recordHubImport(
              hubItemId,
              presetIds,
              presetIds[0] ? presetRoute(presetIds[0]) : "/play/skirmish",
            )
          }
        />
      ),
    });
  };

  // Open the import drawer with the deep link's code prefilled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (importCode) void openImport(importCode);
  }, [importCode]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Setup packs</h1>
          <p className="text-sm text-muted-foreground">
            Share your exact setup, an engine version, a game, a map list and
            optionally presets, as one small code someone else can paste in.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => openImport()}>
            <Download className="mr-1.5 size-4" aria-hidden /> Import
          </Button>
          <Button onClick={openExport} disabled={!ready}>
            <Package2 className="mr-1.5 size-4" aria-hidden /> Export
          </Button>
        </div>
      </header>

      {!ready && (
        <p className="text-sm text-muted-foreground">
          Install an engine and a game before exporting a pack. Importing a pack
          from someone else works regardless.
        </p>
      )}
    </div>
  );
}

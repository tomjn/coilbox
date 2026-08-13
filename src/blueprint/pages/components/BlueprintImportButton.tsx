/**
 * Import a blueprint somebody shared, from a code or a file (issue #1439).
 *
 * The button only opens the drawer. {@link ImportBlueprintForm} owns the decode,
 * the game and unit checks and the error state, the way the scenario import
 * does, and this is a drawer rather than a dialog because that is the standing
 * preference in this codebase.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { Download } from "lucide-react";
import { useEffect } from "react";

import { nextDrawerKey } from "@/general/drawerKey";
import type { StoredBlueprint } from "../../library";

export function BlueprintImportButton({
  initialCode,
  onImported,
}: {
  /** A confirmed `coilbox://import` code, which opens the drawer with it
   *  prefilled and reads it once (issue #388). */
  initialCode?: string;
  onImported: (record: StoredBlueprint) => void;
}) {
  const drawer = useDrawer();

  const openImport = async (code?: string) => {
    const { ImportBlueprintForm } = await import("./ImportBlueprintForm");
    drawer.open({
      title: "Import a blueprint",
      width: "28rem",
      content: (
        // A fresh form every time, because the last one may still be mounted
        // and would keep the code it already read (issue #1395).
        <ImportBlueprintForm
          key={nextDrawerKey()}
          initialCode={code}
          onImported={(record) => {
            drawer.close();
            onImported(record);
          }}
        />
      ),
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (initialCode) void openImport(initialCode);
  }, [initialCode]);

  return (
    <Button
      variant="outline"
      className="shrink-0 gap-1.5"
      onClick={() => void openImport()}
    >
      <Download className="size-4" /> Import
    </Button>
  );
}

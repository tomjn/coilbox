/**
 * Open a file holding somebody else's collection of layouts (issue #1313).
 *
 * The button only opens the drawer. {@link ImportPackForm} owns the file, the
 * game it is read against and everything that is kept, the same way the single
 * layout import does, and it is a drawer rather than a dialog because that is
 * the standing preference in this codebase.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { Layers } from "lucide-react";

import { nextDrawerKey } from "@/general/drawerKey";
import type { StoredBlueprint } from "../../library";

export function BlueprintPackButton({
  onImported,
}: {
  onImported: (records: StoredBlueprint[]) => void;
}) {
  const drawer = useDrawer();

  const openPack = async () => {
    const { ImportPackForm } = await import("./ImportPackForm");
    drawer.open({
      title: "Open a pack of blueprints",
      // Wider than the single layout import: this is a list to skim, and thirty
      // rows each carrying a drawing want the room.
      width: "34rem",
      content: (
        <ImportPackForm
          key={nextDrawerKey()}
          onImported={(records) => {
            drawer.close();
            onImported(records);
          }}
        />
      ),
    });
  };

  return (
    <Button
      variant="outline"
      className="shrink-0 gap-1.5"
      onClick={() => void openPack()}
    >
      <Layers className="size-4" /> Open a pack
    </Button>
  );
}

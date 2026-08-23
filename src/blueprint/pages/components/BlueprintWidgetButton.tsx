/**
 * The way to the in game widget (issue #1419). Opens the drawer, and
 * {@link WidgetPanel} owns the state and the buttons.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { Puzzle } from "lucide-react";

import { nextDrawerKey } from "@/general/drawerKey";

export function BlueprintWidgetButton({
  onChanged,
}: {
  onChanged: (said: string) => void;
}) {
  const drawer = useDrawer();

  const openPanel = async () => {
    const { WidgetPanel } = await import("./WidgetPanel");
    drawer.open({
      title: "In game widget",
      width: "30rem",
      content: <WidgetPanel key={nextDrawerKey()} onChanged={onChanged} />,
    });
  };

  return (
    <Button
      variant="outline"
      className="shrink-0 gap-1.5"
      onClick={() => void openPanel()}
    >
      <Puzzle className="size-4" /> Widget
    </Button>
  );
}

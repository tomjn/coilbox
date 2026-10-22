/**
 * Make a file of layouts out of your own library (issue #1474).
 *
 * The other half of the button beside it. This one only opens the drawer, and
 * {@link WritePackForm} owns the choosing, the destination and the write, the
 * same way the pack import does.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useDrawer } from "@picoframe/frame";
import { PackagePlus } from "lucide-react";

import { nextDrawerKey } from "@/general/drawerKey";

export function BlueprintPackWriteButton({
  onWritten,
}: {
  onWritten: (said: string) => void;
}) {
  const drawer = useDrawer();
  const { t } = useLingui();

  const openWrite = async () => {
    const { WritePackForm } = await import("./WritePackForm");
    drawer.open({
      title: t`Save a pack of blueprints`,
      // As wide as the one that reads a pack: the same rows with the same
      // drawings on them want the same room.
      width: "34rem",
      content: (
        <WritePackForm
          key={nextDrawerKey()}
          onWritten={(said) => {
            drawer.close();
            onWritten(said);
          }}
        />
      ),
    });
  };

  return (
    <Button
      variant="outline"
      className="shrink-0 gap-1.5"
      onClick={() => void openWrite()}
    >
      <PackagePlus className="size-4" /> <Trans>Save a pack</Trans>
    </Button>
  );
}

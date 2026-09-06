import { Button, useDrawer } from "@picoframe/frame";
import { Package2, Share2, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isProfileHidden } from "../../../profile/hidden";
import { ShareAssetsPanel } from "./ShareAssetsPanel";

/**
 * The hub page's one visible way in to sharing something (issue #2562).
 *
 * "Share a pack" used to be its own button beside "Hub website", and the four
 * controls for a player's maps and games lived only in Settings, reached from
 * here by a muted "Signed in as ..." link nobody would guess pointed there.
 * Folding the pack button into this menu leaves one visible "Share" control
 * rather than two buttons that would both say share.
 *
 * "Share your maps and games" opens `ShareAssetsPanel` in a drawer rather than
 * navigating to Settings, so agreeing to sharing and running a sweep both
 * happen without leaving the hub page. It stays offered even to somebody who
 * has turned automatic sharing off, since that is exactly who needs a way to
 * trigger one by hand. Signing in, if needed, happens inside that panel the
 * same way the pack drawer already asks for it (`../../PublishSection.tsx`).
 */
export function ShareMenu({ hubUrl }: { hubUrl: string }) {
  const drawer = useDrawer();

  const openExport = async () => {
    const { ExportPackForm } = await import(
      "../../../packs/pages/components/ExportPackForm"
    );
    drawer.open({
      title: "Share a setup pack",
      width: "26rem",
      content: <ExportPackForm />,
    });
  };

  const openAssets = () => {
    drawer.open({
      title: "Share your maps and games",
      width: "26rem",
      content: <ShareAssetsPanel hubUrl={hubUrl} />,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="size-4" aria-hidden="true" /> Share
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!isProfileHidden("content.setupPacks") && (
          <DropdownMenuItem onSelect={() => void openExport()}>
            <Package2 className="size-4" aria-hidden="true" /> Share a pack
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={openAssets}>
          <Upload className="size-4" aria-hidden="true" /> Share your maps and
          games
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

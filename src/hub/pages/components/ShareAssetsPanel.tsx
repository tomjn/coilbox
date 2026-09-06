import { isHubAssetUploadOffered } from "../../../profile/profile";
import { useAssetUploadConsent } from "../../assetUploads";
import { AccountControl } from "./AccountControl";
import { AssetUploadControl } from "./AssetUploadControl";
import { GameFactsControl } from "./GameFactsControl";
import { GamePicturesControl } from "./GamePicturesControl";
import { MapCatalogControl } from "./MapCatalogControl";
import { MapPicturesControl } from "./MapPicturesControl";

/**
 * Signing in and the four sharing controls: what sending a player's maps and
 * games to the hub actually takes, shared between Settings > Coilbox hub
 * (`../SettingsSection.tsx`) and the hub page's Share menu (`./ShareMenu.tsx`,
 * issue #2562).
 *
 * Signing in sits above the switch because which account the four controls
 * publish under depends on who is signed in, not on which hub address is in
 * use - the address override itself is a Settings-only field, so it stays
 * there rather than moving into this shared panel.
 *
 * Sending pictures made from local game files (issue #1635) is the switch:
 * the one thing here that takes something off this machine and publishes it.
 * Sending what the maps say (issue #1737) and what the games say (issue #1875)
 * ride that same agreement rather than a second switch, and appear only once
 * it has been given - either sweep reads every archive of its kind on the
 * machine, and nothing about opening this panel says that is wanted now.
 *
 * Four sections and not three, because a map and a game each have two halves
 * to contribute: what it says, and what it looks like.
 */
export function ShareAssetsPanel({ hubUrl }: { hubUrl: string }) {
  const [uploadsAgreed, setUploadsAgreed] = useAssetUploadConsent();
  const offered = isHubAssetUploadOffered();

  return (
    <div className="space-y-6">
      <AccountControl hubUrl={hubUrl} />
      <AssetUploadControl
        agreed={uploadsAgreed}
        onChange={setUploadsAgreed}
        offered={offered}
      />
      {offered && (
        <>
          <MapCatalogControl hubUrl={hubUrl} agreed={uploadsAgreed} />
          <MapPicturesControl hubUrl={hubUrl} agreed={uploadsAgreed} />
          <GameFactsControl hubUrl={hubUrl} agreed={uploadsAgreed} />
          <GamePicturesControl hubUrl={hubUrl} agreed={uploadsAgreed} />
        </>
      )}
    </div>
  );
}

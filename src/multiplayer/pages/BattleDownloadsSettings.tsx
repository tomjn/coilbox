import { useSetting } from "@picoframe/frame";
import { Switch } from "@/components/ui/switch";
import { AUTO_DOWNLOAD_ON_JOIN_KEY } from "../battle/autoDownload";

/**
 * Settings section at /settings/battle-downloads (issue #439). One opt-out for
 * auto-downloading a battle's missing game/map when you join. On (the default),
 * joining starts the fetch straight away; off restores the manual Download button.
 */
export default function BattleDownloadsSettings() {
  const [autoOnJoin, setAutoOnJoin] = useSetting<boolean>(
    AUTO_DOWNLOAD_ON_JOIN_KEY,
    true,
  );

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor="auto-download-on-join"
        className="flex items-center justify-between gap-4"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            Auto-download missing content on join
          </span>
          <span className="text-xs text-muted-foreground">
            When you join a battle whose game or map you don't have, start the
            download automatically instead of waiting for a click. The Download
            button stays available to pause or retry.
          </span>
        </span>
        <Switch
          id="auto-download-on-join"
          checked={autoOnJoin}
          onCheckedChange={setAutoOnJoin}
        />
      </label>
    </div>
  );
}

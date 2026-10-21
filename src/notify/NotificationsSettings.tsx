import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useSetting } from "@picoframe/frame";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { SavedSearchSettings } from "../multiplayer/battles/SavedSearchSettings";
import { NOTIFY_OS_ENABLED_KEY, NOTIFY_OS_SOUND_KEY } from "./NotifyProvider";
import { notify } from "./notify";
import { setPermGranted } from "./prefs";

/** Settings section at /settings/notifications. */
export default function NotificationsSettings() {
  const { t } = useLingui();
  const [osEnabled, setOsEnabled] = useSetting<boolean>(
    NOTIFY_OS_ENABLED_KEY,
    true,
  );
  const [osSound, setOsSound] = useSetting<boolean>(NOTIFY_OS_SOUND_KEY, true);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    isPermissionGranted()
      .then(setGranted)
      .catch(() => setGranted(false));
  }, []);

  const grant = async () => {
    const result = await requestPermission();
    const ok = result === "granted";
    setGranted(ok);
    setPermGranted(ok);
  };

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor="notifications-os-enabled"
        className="flex items-center justify-between gap-4"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            <Trans>Desktop notifications</Trans>
          </span>
          <span className="text-xs text-muted-foreground">
            <Trans>
              Show a native notification when the app is in the background.
            </Trans>
          </span>
        </span>
        <Switch
          id="notifications-os-enabled"
          checked={osEnabled}
          onCheckedChange={setOsEnabled}
        />
      </label>

      <label
        htmlFor="notifications-os-sound"
        className="flex items-center justify-between gap-4"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            <Trans>Notification sound</Trans>
          </span>
          <span className="text-xs text-muted-foreground">
            <Trans>
              Let the banner make your system's notification sound. Your
              operating system owns that sound and its volume, so Coilbox's own
              volume does not apply, though muting all sound does.
            </Trans>
          </span>
        </span>
        <Switch
          id="notifications-os-sound"
          checked={osSound}
          onCheckedChange={setOsSound}
          disabled={!osEnabled}
        />
      </label>

      <div className="flex items-center gap-3">
        {granted === null ? (
          <span className="text-sm text-muted-foreground">
            <Trans>Checking permission…</Trans>
          </span>
        ) : granted ? (
          <span className="text-sm text-muted-foreground">
            <Trans>Permission granted.</Trans>
          </span>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              <Trans>Permission not granted.</Trans>
            </span>
            <Button onClick={() => void grant()}>
              <Trans>Grant permission</Trans>
            </Button>
          </>
        )}
      </div>

      <SavedSearchSettings />

      <div>
        <Button
          onClick={() =>
            void notify({
              title: "Coilbox",
              body: t`Test notification`,
              level: "success",
            })
          }
        >
          <Trans>Send test notification</Trans>
        </Button>
      </div>
    </div>
  );
}

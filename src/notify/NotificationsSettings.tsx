import { Button, useSetting } from "@picoframe/frame";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { NOTIFY_OS_ENABLED_KEY } from "./NotifyProvider";
import { notify } from "./notify";
import { setPermGranted } from "./prefs";

/** Settings section at /settings/notifications. */
export default function NotificationsSettings() {
  const [osEnabled, setOsEnabled] = useSetting<boolean>(
    NOTIFY_OS_ENABLED_KEY,
    true,
  );
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
          <span className="text-sm font-medium">Desktop notifications</span>
          <span className="text-xs text-muted-foreground">
            Show a native notification when the app is in the background.
          </span>
        </span>
        <Switch
          id="notifications-os-enabled"
          checked={osEnabled}
          onCheckedChange={setOsEnabled}
        />
      </label>

      <div className="flex items-center gap-3">
        {granted === null ? (
          <span className="text-sm text-muted-foreground">
            Checking permission…
          </span>
        ) : granted ? (
          <span className="text-sm text-muted-foreground">
            Permission granted.
          </span>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              Permission not granted.
            </span>
            <Button onClick={() => void grant()}>Grant permission</Button>
          </>
        )}
      </div>

      <div>
        <Button
          onClick={() =>
            void notify({
              title: "Coilbox",
              body: "Test notification",
              level: "success",
            })
          }
        >
          Send test notification
        </Button>
      </div>
    </div>
  );
}

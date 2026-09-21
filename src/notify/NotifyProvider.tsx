import { useSetting } from "@picoframe/frame";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { setOsEnabled, setOsSound, setPermGranted } from "./prefs";

export const NOTIFY_OS_ENABLED_KEY = "notifications.os.enabled";
export const NOTIFY_OS_SOUND_KEY = "notifications.os.sound";

/**
 * App-wide: mounts the sonner toast host and mirrors the user's OS-notification
 * toggle and the current OS permission grant into the prefs bridge, so the
 * imperative notify() helper can read them synchronously from anywhere.
 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [osEnabled] = useSetting<boolean>(NOTIFY_OS_ENABLED_KEY, true);
  const [osSound] = useSetting<boolean>(NOTIFY_OS_SOUND_KEY, true);

  useEffect(() => {
    setOsEnabled(osEnabled);
  }, [osEnabled]);

  useEffect(() => {
    setOsSound(osSound);
  }, [osSound]);

  useEffect(() => {
    isPermissionGranted()
      .then(setPermGranted)
      .catch(() => setPermGranted(false));
  }, []);

  return (
    <>
      {children}
      <Toaster />
    </>
  );
}

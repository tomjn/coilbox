import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useSetting } from "@picoframe/frame";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { getProfile } from "@/profile/profile";
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
  const [grantError, setGrantError] = useState<string | null>(null);

  useEffect(() => {
    isPermissionGranted()
      .then(setGranted)
      .catch(() => setGranted(false));
  }, []);

  const grant = async () => {
    setGrantError(null);
    let ok = false;
    try {
      ok = (await requestPermission()) === "granted";
    } catch {
      ok = false;
    }
    setGranted(ok);
    setPermGranted(ok);
    if (!ok) {
      setGrantError(
        t`Not allowed. Turn on notifications for this app in your system settings.`,
      );
    }
  };

  return (
    <div className="flex flex-col gap-10 pb-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Desktop</Trans>
        </h2>
        <SettingList>
          <SettingRow
            id="notifications-os-enabled"
            label={t`Show notifications`}
            description={t`When the app is in the background`}
          >
            <Switch
              id="notifications-os-enabled"
              aria-describedby="notifications-os-enabled-description"
              checked={osEnabled}
              onCheckedChange={setOsEnabled}
            />
          </SettingRow>
          <SettingRow
            id="notifications-os-sound"
            label={t`Notification sound`}
            helpLabel={t`About the notification sound`}
            help={
              <p>
                <Trans>
                  Your system plays this sound at its own volume, so Coilbox's
                  volume does not change it. Muting all sound does turn it off.
                </Trans>
              </p>
            }
          >
            <Switch
              id="notifications-os-sound"
              checked={osSound}
              onCheckedChange={setOsSound}
              disabled={!osEnabled}
            />
          </SettingRow>
          <SettingRow
            label={t`System permission`}
            description={
              granted === null
                ? t`Checking…`
                : granted
                  ? t`Allowed`
                  : t`Not allowed`
            }
            error={grantError}
          >
            {granted === false && (
              <Button variant="outline" onClick={() => void grant()}>
                <Trans>Allow</Trans>
              </Button>
            )}
          </SettingRow>
          <SettingRow label={t`Test notification`}>
            <Button
              variant="outline"
              onClick={() =>
                void notify({
                  title: getProfile().title ?? "Coilbox",
                  body: t`Test notification`,
                  level: "success",
                })
              }
            >
              <Trans>Send</Trans>
            </Button>
          </SettingRow>
        </SettingList>
      </section>

      <SavedSearchSettings />
    </div>
  );
}

import { Trans, useLingui } from "@lingui/react/macro";
import { useSetting } from "@picoframe/frame";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { isHubAssetUploadOffered } from "@/profile/profile";
import { AUTO_SEND_REPLAYS_KEY } from "./queue";

/**
 * The switch in Settings > Coilbox hub that sends every finished match the
 * player was in (issue #5494). The setting is only what the player asked for:
 * the hub plugin reads it off disk before a replay goes without a press of its
 * send button.
 */
export function ReplayAutoSendControl() {
  const { t } = useLingui();
  const [on, setOn] = useSetting<boolean>(AUTO_SEND_REPLAYS_KEY, false);
  const label = t`Send my finished multiplayer matches to the hub`;
  const offered = isHubAssetUploadOffered();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        <Trans>Replays</Trans>
      </h2>
      <SettingList>
        {offered ? (
          <SettingRow
            id="hub-auto-send-replays"
            label={label}
            description={t`Replays on the hub are public. Sending needs you to be signed in.`}
            help={
              <>
                <p>
                  <Trans>
                    When a match ends, Coilbox sends its replay if you played in
                    it or watched it, people were on two or more sides, and it
                    reached game over. Single player matches and matches against
                    AI alone are not sent. Anyone can download a replay and see
                    the players, the build orders and the totals, and the hub
                    notes that you sent it.
                  </Trans>
                </p>
                <p>
                  <Trans>
                    If the hub cannot be reached, Coilbox keeps trying for a
                    week. Turning this off forgets anything still waiting.
                  </Trans>
                </p>
              </>
            }
            helpLabel={t`About sending your matches`}
          >
            <Switch
              id="hub-auto-send-replays"
              checked={on}
              onCheckedChange={setOn}
              aria-describedby="hub-auto-send-replays-description"
            />
          </SettingRow>
        ) : (
          <SettingRow
            label={label}
            description={t`Your distribution has switched off sending to the hub.`}
          >
            {null}
          </SettingRow>
        )}
      </SettingList>
    </section>
  );
}

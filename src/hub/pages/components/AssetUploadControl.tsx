import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/i18n/uiError";

/**
 * Agreeing to send pictures to the hub, in Settings > Coilbox hub (issue #1635),
 * as one row of the sharing list.
 *
 * Somebody reading it has probably never thought about where a picture of a
 * unit comes from, and is being asked to publish things derived from files they
 * did not make. The warning that matters before pressing, that it is public and
 * hard to take back, stays under the name. The help button says what happens in
 * the order it happens - reads local files, makes pictures, sends them under
 * your name - and why it is worth a moment's thought.
 *
 * Presentational on purpose: the setting is read and written by the caller, and
 * nothing here enforces anything. The gate is in the Rust plugin, at
 * `crates/tauri-plugin-coilbox-hub/src/consent.rs`, which reads the same setting
 * off disk before an upload path may run.
 *
 * `offered` false is a distribution that set `hubAssetUploads: false`. It gets a
 * sentence rather than nothing, because a player who has heard of the feature is
 * better served knowing it was switched off than hunting for a control that is
 * not there.
 */
export function AssetUploadControl({
  agreed,
  offered,
  onChange,
}: {
  agreed: boolean;
  offered: boolean;
  /** May be the async setter from `useAssetUploadConsent`, which resolves once
   *  the answer is on disk. Nothing here waits for it: the switch moves on the
   *  frame's own state, and there is nothing to say while a file is written. */
  onChange: (next: boolean) => void | Promise<void>;
}) {
  const { t } = useLingui();
  const [failed, setFailed] = useState<string | null>(null);
  const label = t`Send pictures of your games and maps to the hub`;

  if (!offered) {
    return (
      <SettingRow
        label={label}
        description={t`Your distribution has switched off sending pictures to the hub, so Coilbox will not upload any.`}
      >
        {null}
      </SettingRow>
    );
  }

  // The answer is written to disk, where the Rust side reads it before any
  // upload, so a write that failed leaves the switch saying one thing and the
  // gate another. Say so rather than leave an unhandled rejection.
  const change = async (next: boolean) => {
    setFailed(null);
    try {
      await onChange(next);
    } catch (e) {
      setFailed(describeError(e));
    }
  };

  return (
    <SettingRow
      id="hub-asset-uploads"
      label={label}
      description={t`What you send is public and hard to take back.`}
      error={failed}
      help={
        <>
          <p>
            <Trans>
              Off unless you turn it on. When it is on, Coilbox reads the game
              and map files on this computer, makes pictures of the units and
              maps inside them, and sends those pictures to the hub under your
              account, with your name on them. It can also send what it measured
              about a map, such as its size, its height range and where players
              start.
            </Trans>
          </p>
          <p>
            <Trans>
              What you send goes into a public repository and stays in its
              history, so it is not like deleting a file you uploaded by
              mistake. The pictures are made from other people's game and map
              archives, and not every archive is clear about what you may do
              with what is inside it. Every upload also spends storage the whole
              community shares.
            </Trans>
          </p>
          <p>
            <Trans>
              Leave this off unless you are happy to publish pictures made from
              the games and maps you have installed.
            </Trans>
          </p>
        </>
      }
      helpLabel={t`About sending pictures`}
    >
      <Switch
        id="hub-asset-uploads"
        checked={agreed}
        onCheckedChange={(next) => void change(next)}
        aria-describedby="hub-asset-uploads-description"
      />
    </SettingRow>
  );
}

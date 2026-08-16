import { Switch } from "@/components/ui/switch";

/**
 * Agreeing to send pictures to the hub, in Settings > Coilbox hub (issue #1635).
 *
 * The words are the point of this control. Somebody reading it has not read the
 * issue, has probably never thought about where a picture of a unit comes from,
 * and is being asked to publish things derived from files they did not make. So
 * it says what happens in the order it happens - reads local files, makes
 * pictures, sends them under your name - and then why it is worth a moment's
 * thought, before offering the switch.
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
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">
        Sending pictures to the hub
      </h3>
      {offered ? (
        <>
          <p className="text-sm text-muted-foreground">
            Off unless you turn it on. When it is on, Coilbox reads the game and
            map files on this computer, makes pictures of the units and maps
            inside them, and sends those pictures to the hub under your account,
            with your name on them.
          </p>
          <p className="text-sm text-muted-foreground">
            What you send is public and hard to take back. It goes into a public
            repository and stays in its history, so it is not like deleting a
            file you uploaded by mistake. The pictures are made from other
            people's game and map archives, and not every archive is clear about
            what you may do with what is inside it. Every upload also spends
            storage the whole community shares.
          </p>
          <p className="text-sm text-muted-foreground">
            Leave this off unless you are happy to publish pictures made from
            the games and maps you have installed.
          </p>
          <label
            htmlFor="hub-asset-uploads"
            className="flex items-center justify-between gap-4 pt-1"
          >
            <span className="text-sm font-medium">
              Send pictures of your games and maps to the hub
            </span>
            <Switch
              id="hub-asset-uploads"
              checked={agreed}
              onCheckedChange={onChange}
            />
          </label>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your distribution has switched off sending pictures to the hub, so
          Coilbox will not upload any.
        </p>
      )}
    </section>
  );
}

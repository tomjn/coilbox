import { t } from "@lingui/core/macro";
import { describeError } from "@/i18n/uiError";
import { notify } from "../../notify/notify";
import { type Battle, mpJoinBattle } from "../bindings";
import { forgetOaPassword, holdOaJoinPassword } from "../oaPassword";
import { newScriptPassword } from "../scriptPassword";

/**
 * Join a battle from anywhere that lists one: the battle list and a friend's
 * row. The one place a join is sent, so the leave-first step, the error shown
 * when it fails and the wait for the join to land are the same for both.
 *
 * `leaveOther` leaves a battle on another server, once the player has agreed to
 * that (issue #2844). `awaitLanding` is called just before the join goes out and
 * `giveUp` if it could not be sent, so the caller can take the player to the
 * battle room when the join lands. `key` is the battle password, if any.
 */
export async function joinBattle(args: {
  serverKey: string;
  battle: Battle;
  key?: string;
  leaveOther: () => Promise<void>;
  awaitLanding: () => void;
  giveUp: () => void;
}): Promise<void> {
  const { serverKey, battle, key, leaveOther, awaitLanding, giveUp } = args;
  try {
    await leaveOther();
  } catch (e) {
    const reason = describeError(e);
    void notify({
      title: t`You are still in your other battle`,
      body: t`Coilbox could not leave it: ${reason}.`,
      level: "error",
    });
    return;
  }
  awaitLanding();
  holdOaJoinPassword(serverKey, battle, key);
  try {
    await mpJoinBattle({
      serverKey,
      id: battle.id,
      key,
      scriptPassword: newScriptPassword(),
    });
  } catch {
    // Wire-level failures surface via lastJoinError or a disconnect.
    forgetOaPassword();
    giveUp();
  }
}

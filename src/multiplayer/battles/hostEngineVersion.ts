import { t } from "@lingui/core/macro";
import { describeError } from "@/i18n/uiError";
import { contentVerifyEngine } from "../../content/bindings";
import { refreshContentState } from "../../content/contentState";
import { isRealEngineVersion } from "../../content/engineVersion";
import type { PlayTarget } from "../../play/config";

/**
 * The engine version a hosted battle advertises: the one the engine binary
 * reports, never the name of the folder it sits in.
 *
 * Joiners look an engine up by this exact string. An engine nobody verified only
 * has its folder name, and a folder named after the archive it came from, like
 * `recoil_2025.06.20_amd64-linux.7z`, sent every SkyLobby player on Windows to
 * download the Linux build of an engine they already had. So an unverified
 * engine is verified here, and a battle whose engine cannot say its version is
 * not opened.
 */
export async function hostEngineVersion(
  target: Pick<PlayTarget, "executable" | "syncVersion">,
): Promise<string> {
  if (isRealEngineVersion(target.syncVersion)) {
    return (target.syncVersion as string).trim();
  }
  let reported: string | undefined;
  try {
    const { engine } = await contentVerifyEngine({ path: target.executable });
    reported = engine.syncVersion;
    refreshContentState().catch(() => {});
  } catch (err) {
    const reason = describeError(err);
    throw new Error(t`Could not read the engine's version: ${reason}`);
  }
  if (!isRealEngineVersion(reported)) {
    throw new Error(t`Could not read the engine's version.`);
  }
  return (reported as string).trim();
}

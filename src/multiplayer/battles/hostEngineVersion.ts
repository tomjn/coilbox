import { contentVerifyEngine } from "../../content/bindings";
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
  if (target.syncVersion) return target.syncVersion;
  let reported: string | undefined;
  try {
    const { engine } = await contentVerifyEngine({ path: target.executable });
    reported = engine.syncVersion;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read the engine's version: ${reason}`);
  }
  if (!reported) {
    throw new Error("Could not read the engine's version.");
  }
  return reported;
}

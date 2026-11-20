/**
 * The game releases this machine has sent to a hub with "Send to hub".
 *
 * A game page offers the send when the hub shows no picture of a start unit.
 * The hub only shows a picture once a moderator approves it, so straight after
 * a send by somebody who is not a moderator the pictures are still missing from
 * the public answer. Without this record the button would come straight back
 * and offer a send that has nothing left to do.
 */

const KEY = "coilbox.hub.gamesSentHere";

function id(hubUrl: string, shortname: string, release: string): string {
  return `${hubUrl.replace(/\/+$/, "")}\n${shortname.toLowerCase()}\n${release}`;
}

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((one): one is string => typeof one === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether this machine has sent this release of the game to this hub. */
export function sentHere(
  hubUrl: string,
  shortname: string,
  release: string,
): boolean {
  return read().includes(id(hubUrl, shortname, release));
}

/** Write down that this release of the game was sent to this hub. */
export function rememberSentHere(
  hubUrl: string,
  shortname: string,
  release: string,
): void {
  const one = id(hubUrl, shortname, release);
  const all = read();
  if (all.includes(one)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...all, one]));
  } catch (e) {
    console.warn("could not remember a hub send", e);
  }
}

/**
 * What to tell a host whose battle would not open. Pure.
 *
 * A refusal that never reaches the wire, such as a password the line cannot
 * carry, arrives as a rejected command and nothing else: there is no
 * `lastJoinError`, because the server never saw it, and no disconnect, because
 * the connection is fine. So this is the only thing the host has to read, and
 * dropping it left them pressing a button that did nothing (issue #1591).
 */

import { t } from "@lingui/core/macro";
import { describeError } from "@/i18n/uiError";

/**
 * Why a typed battle title cannot be sent, or null when it can. Pure. The title
 * is one tab-separated field of the `OPENBATTLE` line, so a tab in it replaces
 * the game's name with the text after it (issue #4916). A form trims the title
 * before it sends it, so the edges are not checked. The check is the one the
 * backend applies, which is any control character.
 */
export function battleTitleProblem(typed: string): string | null {
  return /\p{Cc}/u.test(typed.trim())
    ? t`The title cannot contain a tab or another control character.`
    : null;
}

export function hostBattleFailure(error: unknown): string {
  const raw = describeError(error ?? "").trim();
  return raw
    ? t`Could not host the battle: ${raw}`
    : t`Could not host the battle.`;
}

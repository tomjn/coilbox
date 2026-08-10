import { useSetting } from "@picoframe/frame";
import { getProfile, isHubEnabled } from "../profile/profile";

/**
 * The Coilbox hub base URL: three layers, the same shape as
 * `src/lobby-servers/config.ts`. A built-in default in code, a profile-supplied
 * override for a distributor running their own hub, and a user setting on top of
 * that. Kept to one address, the API paths (`/api/v1/items`, etc.) hang off it and
 * are not independently configurable.
 *
 * Nothing consumes this yet. Issues #1346, #1347 and #1349 will, once they land.
 */

/** The public hub, live at this address. */
export const DEFAULT_HUB_URL = "https://coilbox-hub.vercel.app";

/** The user's hub URL override, persisted under `hub.url`. Empty means unset. */
export function useHubUrlSetting() {
  return useSetting<string>("hub.url", "");
}

/**
 * Resolve the effective hub base URL: a non-blank user setting wins, then the
 * profile's `hubUrl` override, then {@link DEFAULT_HUB_URL}. Pure, so it's
 * unit-testable without a live settings store or profile singleton.
 */
export function resolveHubUrl(userUrl: string, profileUrl?: string): string {
  const user = userUrl.trim();
  if (user) return user;
  return profileUrl?.trim() || DEFAULT_HUB_URL;
}

/**
 * Is this an address the hub setting should accept? Blank (and whitespace-only)
 * is valid, meaning unset per {@link resolveHubUrl}, so only a non-blank value
 * has to parse as an http or https URL. Used by the settings control (issue
 * #1353) to reject something that would just fail on every request with a
 * confusing error instead.
 */
export function isValidHubUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "") return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The effective hub base URL for the running session. This is what every hub
 * consumer should call rather than hardcoding the address (the anti-pattern named
 * in issue #1351 is `DEFAULT_BRANDING_CATALOG_URL` in `src/content/branding.ts`,
 * which has no override at all).
 */
export function useHubUrl(): string {
  const [userUrl] = useHubUrlSetting();
  return resolveHubUrl(userUrl, getProfile().hubUrl);
}

/**
 * The hub this session actually trusts, or null when there isn't one. That is
 * {@link useHubUrl}, except a profile that switched the hub off (`isHubEnabled`)
 * has no configured hub at all, so a `coilbox://` link pointing at the address it
 * used to use is a stranger's link like any other.
 *
 * Callers that only need an address to fetch from want {@link useHubUrl}. This is
 * for the ones deciding how much to trust something, and it pairs with
 * {@link isHubOrigin} (issue #1367).
 */
export function useTrustedHubUrl(): string | null {
  const hubUrl = useHubUrl();
  return isHubEnabled() ? hubUrl : null;
}

/**
 * Is `url` served by `hubUrl`? Compares parsed origins - scheme, host and port -
 * never string prefixes, because a prefix test hands the hub's name to anybody who
 * can register a longer one. `https://coilbox-hub.vercel.app.evil.test/` is a
 * different host, `https://coilbox-hub.vercel.app@evil.test/` is `evil.test` with
 * the hub's name as a username, and `http://` is not `https://`. All three are a
 * different origin, so all three are false.
 *
 * A null or unparseable `hubUrl` means there is no configured hub, which trusts
 * nothing. Only http and https origins can match, so a `file:` or `data:` URL
 * (whose origin is the opaque string "null") can never pair up with another.
 */
export function isHubOrigin(
  url: string,
  hubUrl: string | null | undefined,
): boolean {
  if (!hubUrl) return false;
  try {
    const target = new URL(url);
    const hub = new URL(hubUrl);
    if (hub.protocol !== "http:" && hub.protocol !== "https:") return false;
    return target.origin === hub.origin;
  } catch {
    return false;
  }
}

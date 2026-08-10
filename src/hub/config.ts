import { useSetting } from "@picoframe/frame";
import { getProfile } from "../profile/profile";

/**
 * The community hub base URL: three layers, the same shape as
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

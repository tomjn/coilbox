import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Version string with exactly one leading `v`. Some game/map version strings
 * already start with their own `v` (e.g. `"v1"`), so blindly prefixing gives
 * `"vv1"`; strip an existing leading `v`/`V` (only when it's a version prefix,
 * i.e. followed by a digit or dot) before re-adding one.
 */
export function versionLabel(version: string): string {
  return `v${version.replace(/^v(?=[\d.])/i, "")}`;
}

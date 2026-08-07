import type { NavItem } from "@picoframe/plugin-sdk";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Resolve a nav item's live presentation, in one fixed hook-call order.
 *
 * picoframe's own `useResolvedNavItem` is internal to the package, so this is a
 * copy. Every hook runs even where the result is unused, because hooks must run
 * unconditionally per fiber. As picoframe requires, a given item id must
 * consistently define, or not define, each hook.
 *
 * Shared between the tool card and the links card, which draw the same nav items
 * two different ways and must agree on which are hidden and what they are called.
 */
export function useResolvedNavItem(item: NavItem) {
  return {
    // biome-ignore-start lint/correctness/useHookAtTopLevel: the hook call is guarded by whether the nav item defines it, which picoframe's contract requires to be stable for a given item id. The sidebar resolves items the same way.
    visible: item.useVisible ? item.useVisible() : true,
    label: item.useLabel ? item.useLabel() : item.label,
    icon: item.useIcon ? item.useIcon() : item.icon,
    description: item.useDescription ? item.useDescription() : item.description,
    // biome-ignore-end lint/correctness/useHookAtTopLevel: end of the guarded resolver
  };
}

/**
 * Hand a nav item's external URL to the OS browser.
 *
 * Nothing on the home page emits an `<a>` to the outside world: in a webview that
 * navigates away from Coilbox itself, with no way back. Both the tool card and the
 * links card therefore render external items as buttons that call this.
 *
 * A rejection is logged and swallowed. The user asked to leave the app, the app
 * has nothing to show them if the OS refuses, and an unhandled rejection here
 * would be the only visible symptom.
 */
export function openExternal(href: string): void {
  openUrl(href).catch((err) =>
    console.error(`home: could not open external url: ${href}`, err),
  );
}

import type { LayoutConfig } from "@picoframe/frame";
import type { FramePlugin, SlotContribution } from "@picoframe/plugin-sdk";
import { resolveLinkIcon } from "./links";
import { getProfile, type Profile, type ProfileLayout } from "./profile";

/**
 * Map a profile's `layout` block onto a frame {@link LayoutConfig}, merged onto
 * the default popover config (a popover sidebar the user may still toggle, kept
 * unless the profile changes chrome around it). Booleans become bare-value locks
 * (breadcrumb.hidden, history.buttons — authoritative, not user-toggleable).
 * `menu.icon`/`iconOpen` resolve via the shared lucide-name map. `menuImage` is
 * the pre-resolved logo data URI (or null); it becomes `menuLabelContent` and,
 * like a visible label, defaults `labelVisible` to true (the frame renders
 * neither unless it is).
 */
export function buildLayoutConfig(
  profile: Profile,
  menuImage: string | null,
): LayoutConfig {
  const sidebar: NonNullable<LayoutConfig["sidebar"]> = {
    popover: { default: true, userConfigurable: true },
  };
  const cfg: LayoutConfig = { sidebar };
  const layout = profile.layout;
  if (!layout) return cfg;

  if (layout.hideBreadcrumb) cfg.breadcrumb = { hidden: true };
  if (layout.historyButtons !== undefined)
    cfg.history = { buttons: layout.historyButtons };

  const menu = layout.menu;
  if (menu) {
    if (menu.icon) sidebar.menuIcon = resolveLinkIcon(menu.icon);
    if (menu.iconOpen) sidebar.menuIconOpen = resolveLinkIcon(menu.iconOpen);
    if (menu.label) sidebar.menuLabel = menu.label;
    const content = menuImage ? (
      <img src={menuImage} alt="" className="h-5 w-auto" />
    ) : undefined;
    if (content) sidebar.menuLabelContent = content;
    const hasVisible = menu.label != null || content != null;
    if (menu.labelVisible !== undefined)
      sidebar.menuLabelVisible = menu.labelVisible;
    else if (hasVisible) sidebar.menuLabelVisible = true;
  }
  return cfg;
}

/**
 * Resolve which piece of centered top-bar content to render. Image wins over text
 * when it resolved; falls back to text when the image failed; `null` when there's
 * nothing to show. `image` is the pre-resolved data URI (or null).
 */
export function resolveCenterContent(
  center: ProfileLayout["center"],
  image: string | null,
): { image: string } | { text: string } | null {
  if (!center) return null;
  if (image) return { image };
  if (center.text) return { text: center.text };
  return null;
}

/**
 * Build the `topbar.center` slot contribution from a profile's `layout.center`,
 * or `null` when there's nothing to show. `centerImage` is the pre-resolved logo
 * data URI (or null).
 */
export function buildCenterSlot(
  profile: Profile,
  centerImage: string | null,
): SlotContribution | null {
  const content = resolveCenterContent(profile.layout?.center, centerImage);
  if (!content) return null;
  const Component = () =>
    "image" in content ? (
      <img src={content.image} alt="" className="h-6 w-auto" />
    ) : (
      <span className="text-sm font-medium">{content.text}</span>
    );
  return { slot: "topbar.center", Component };
}

/**
 * Inject the profile's `topbar.center` slot contribution into the `profile`
 * plugin's slots. Called from `main.tsx` after the center image resolves. Mirrors
 * `applyProfileLinks`: returns the same array by identity when there's no center
 * content, so vanilla Coilbox's top bar is untouched.
 */
export function applyProfileCenterSlot(
  plugins: FramePlugin[],
  centerImage: string | null,
): FramePlugin[] {
  const slot = buildCenterSlot(getProfile(), centerImage);
  if (!slot) return plugins;
  return plugins.map((p) =>
    p.id === "profile" ? { ...p, slots: [...(p.slots ?? []), slot] } : p,
  );
}

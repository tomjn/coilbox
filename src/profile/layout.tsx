import type { LayoutConfig } from "@picoframe/frame";
import type {
  FramePlugin,
  SlotContribution,
  SlotId,
} from "@picoframe/plugin-sdk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ALLOWED_SCHEME, resolveLinkIcon } from "./links";
import {
  getProfile,
  type Profile,
  type ProfileLayout,
  type ProfileLogo,
} from "./profile";

/**
 * Map a profile's `layout` block onto a frame {@link LayoutConfig}. Popover is a
 * bare-value **lock** (no user toggle): `layout.popover` true forces popover mode,
 * otherwise a persistent sidebar. Breadcrumb-hide and history-buttons are likewise
 * bare-value locks. `menu.icon`/`iconOpen` resolve via the shared lucide-name map;
 * `menuImage` is the pre-resolved logo data URI (or null) and becomes
 * `menuLabelContent`, defaulting `labelVisible` to true like a visible label.
 */
export function buildLayoutConfig(
  profile: Profile,
  menuImage: string | null,
): LayoutConfig {
  const layout = profile.layout;
  const sidebar: NonNullable<LayoutConfig["sidebar"]> = {
    popover: layout?.popover === true,
  };
  const cfg: LayoutConfig = { sidebar };
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
 * Resolve which piece of a top-bar logo to render. Image wins over text when it
 * resolved; falls back to text when the image failed; `null` when there's nothing
 * to show. `image` is the pre-resolved data URI (or null).
 */
export function resolveLogoContent(
  logo: ProfileLogo | undefined,
  image: string | null,
): { image: string } | { text: string } | null {
  if (!logo) return null;
  if (image) return { image };
  if (logo.text) return { text: logo.text };
  return null;
}

/** Whether an `href` is a scheme the opener will open (so the logo can be a link). */
export function isLinkable(href: string | undefined): boolean {
  return !!href && ALLOWED_SCHEME.test(href);
}

/**
 * Build a top-bar slot contribution rendering a profile logo (image or text), or
 * `null` when there's nothing to show. `image` is the pre-resolved data URI. When
 * `logo.href` is a valid scheme the logo becomes a button that opens it in the
 * system browser (reusing the opener allow-list `links` uses).
 */
export function buildLogoSlot(
  slot: SlotId,
  logo: ProfileLogo | undefined,
  image: string | null,
): SlotContribution | null {
  const content = resolveLogoContent(logo, image);
  if (!content) return null;
  const href = logo && isLinkable(logo.href) ? logo.href : undefined;
  const Component = () => {
    const inner =
      "image" in content ? (
        <img src={content.image} alt="" className="h-6 w-auto" />
      ) : (
        <span className="text-sm font-medium">{content.text}</span>
      );
    if (!href) return inner;
    return (
      <button
        type="button"
        className="flex items-center rounded-md hover:opacity-80"
        onClick={() => {
          openUrl(href).catch((e) =>
            console.warn("profile: could not open logo link", e),
          );
        }}
      >
        {inner}
      </button>
    );
  };
  return { slot, Component };
}

/**
 * Inject the profile's top-bar logo slots (left/center/right) into the `profile`
 * plugin's slots. Called from `main.tsx` after the logo images resolve; `images`
 * holds the pre-resolved data URIs. Mirrors `applyProfileLinks`: returns the same
 * array by identity when no logos are configured, so vanilla Coilbox is untouched.
 */
export function applyProfileSlots(
  plugins: FramePlugin[],
  images: { left: string | null; center: string | null; right: string | null },
): FramePlugin[] {
  const layout: ProfileLayout | undefined = getProfile().layout;
  const slots = [
    buildLogoSlot("topbar.left", layout?.left, images.left),
    buildLogoSlot("topbar.center", layout?.center, images.center),
    buildLogoSlot("topbar.right", layout?.right, images.right),
  ].filter((s): s is SlotContribution => s !== null);
  if (slots.length === 0) return plugins;
  return plugins.map((p) =>
    p.id === "profile" ? { ...p, slots: [...(p.slots ?? []), ...slots] } : p,
  );
}

import type { IconComponent, NavGroup, NavItem } from "@picoframe/plugin-sdk";
import {
  Bell,
  BookOpen,
  Calendar,
  ExternalLink,
  Gamepad2,
  Globe,
  Hash,
  Heart,
  Info,
  LifeBuoy,
  Link,
  Mail,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Rss,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import type { Profile } from "./profile";

/**
 * Curated map of profile-facing icon names to lucide components. Kept small and
 * imported by name (no full-set passthrough) so the bundle stays lean. lucide 1.x
 * ships no brand marks, so brand-ish names resolve to the nearest generic glyph
 * (e.g. `discord` -> MessagesSquare). Every value is a real export of the installed
 * lucide-react. Unknown or omitted names fall back to ExternalLink.
 */
const ICONS: Record<string, IconComponent> = {
  discord: MessagesSquare,
  forum: MessagesSquare,
  forums: MessagesSquare,
  chat: MessageCircle,
  message: MessageCircle,
  globe: Globe,
  website: Globe,
  web: Globe,
  docs: BookOpen,
  book: BookOpen,
  wiki: BookOpen,
  news: Newspaper,
  blog: Newspaper,
  rss: Rss,
  feed: Rss,
  heart: Heart,
  donate: Heart,
  support: LifeBuoy,
  help: LifeBuoy,
  users: Users,
  community: Users,
  mail: Mail,
  email: Mail,
  contact: Mail,
  link: Link,
  game: Gamepad2,
  play: Gamepad2,
  calendar: Calendar,
  events: Calendar,
  star: Star,
  info: Info,
  hash: Hash,
  channel: Hash,
  bell: Bell,
  updates: Bell,
  trophy: Trophy,
};

/** Resolve a profile icon name to a lucide component; ExternalLink when unknown. */
export function resolveLinkIcon(name?: string): IconComponent {
  if (!name) return ExternalLink;
  return ICONS[name.toLowerCase()] ?? ExternalLink;
}

/** Schemes the Tauri opener will open (matches `opener:default`'s allow-list). */
const ALLOWED_SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

/** Default group label for links that don't set `group`. */
const DEFAULT_GROUP_LABEL = "Links";

/** Base sort order for profile link groups - high, so they sit below feature nav. */
const PROFILE_GROUP_ORDER = 1000;

/**
 * Build sidebar nav groups from a profile's `links`. Groups by the free-text `group`
 * label (first-seen order preserved); links without one collect under "Links".
 * Fails soft like the rest of the profile module: entries missing `label`/`href`, or
 * with an href scheme the opener won't open, are dropped with a warning rather than
 * throwing. Returns [] when there are no valid links, so vanilla Coilbox is untouched.
 */
export function buildProfileNav(profile: Profile): NavGroup[] {
  const links = profile.links;
  if (!Array.isArray(links) || links.length === 0) return [];

  const order: string[] = [];
  const byGroup = new Map<string, NavItem[]>();

  links.forEach((link, i) => {
    if (
      !link ||
      typeof link.label !== "string" ||
      typeof link.href !== "string"
    ) {
      console.warn("profile: skipping link missing label/href", link);
      return;
    }
    if (!ALLOWED_SCHEME.test(link.href)) {
      console.warn(
        `profile: skipping link with unsupported href scheme: ${link.href}`,
      );
      return;
    }
    const groupLabel = link.group?.trim() || DEFAULT_GROUP_LABEL;
    const items = byGroup.get(groupLabel) ?? [];
    if (items.length === 0) {
      byGroup.set(groupLabel, items);
      order.push(groupLabel);
    }
    items.push({
      id: `profile.link.${i}`,
      label: link.label,
      href: link.href,
      icon: resolveLinkIcon(link.icon),
    });
  });

  return order.map((label, gi) => ({
    id: `profile-links-${gi}`,
    label,
    order: PROFILE_GROUP_ORDER + gi,
    items: byGroup.get(label) ?? [],
  }));
}

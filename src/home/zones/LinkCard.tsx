import { Button, cn } from "@picoframe/frame";
import type { NavItem } from "@picoframe/plugin-sdk";
import { ExternalLink } from "lucide-react";
import { CARD_SHELL_CLASS } from "../cardShell";
import { openExternal, useResolvedNavItem } from "../navItem";

/**
 * One card carrying every external link in a group.
 *
 * ## Why one card, and why in the group
 *
 * A link out of the app is not something you can do in Coilbox, so it does not
 * earn a tool card's footprint (issue #1042). It sits in the group its links are
 * declared under rather than in a place of its own, for two reasons:
 *
 * - The reference links the Animation, Mapconv and Lego plugins declare are
 *   `sidebar: false`, so this grid is the only place they appear at all. Their
 *   group is the only thing that says what they are references *for*: "Skeletor
 *   S3O" means something under the Animation heading and very little in a pile of
 *   unrelated links at the foot of the page.
 * - A distribution's `profile.links` are already grouped by the author's own
 *   `group` label, and `buildProfileNav` turns each label into a nav group, which
 *   the grid shows as a heading. Collapsing several groups into one card would
 *   either throw those labels away or rebuild the same grouping inside the card.
 *
 * So a distribution with a dozen links across three groups gets three cards under
 * three headings, not a dozen cards, and the sidebar and the grid still agree.
 *
 * ## No art
 *
 * The card stands for no single tool, and the art chain is keyed by tool id, so
 * there is no id to ask about and inventing one would mean a second art path.
 * {@link CARD_SHELL_CLASS} is the shared shell for a card without art, and none of
 * the dark-island rules apply because there is no picture to sit on.
 *
 * ## One link, or a dozen
 *
 * The links flow as chips and wrap, so one link is a short strip and a dozen is
 * two or three lines. The card takes the full width of the row so it starts on
 * its own line under whatever tool cards the group has.
 */
export default function LinkCard({ items }: { items: readonly NavItem[] }) {
  return (
    // Two elements, because the card needs a line of its own but not the whole
    // width of one. The wrapper is the full-width flex item that pushes the card
    // below the group's tool cards. The card itself hugs its chips, so a group
    // with one link gets a card the size of one link rather than a mostly empty
    // box. Both stand down when every chip inside is gated off by `useVisible`,
    // the wrapper included, because an invisible full-width item would still
    // break the row of tool cards above it.
    <div className="hidden w-full has-[[data-nav-item]]:block">
      <div
        data-link-card=""
        // `cn` rather than a template string: `CARD_SHELL_CLASS` carries
        // `w-full`, and only tailwind-merge reliably lets `w-fit` beat it.
        className={cn(
          CARD_SHELL_CLASS,
          "w-fit max-w-full flex-wrap items-center gap-2 p-3",
        )}
      >
        {items.map((item) => (
          <LinkChip key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

/**
 * One external link, as a button rather than an anchor.
 *
 * Nothing in the app emits an `<a>` to the outside world: the webview would
 * navigate away from Coilbox itself. `openUrl` hands the URL to the OS browser,
 * exactly as the tool card does for the same items.
 */
function LinkChip({ item }: { item: NavItem }) {
  // Mirror the sidebar and the tool card: an item gated off via `useVisible` is
  // hidden here too. Resolved before the early return, in a per-item component,
  // so the hook order is stable.
  const { visible, label, icon: Icon } = useResolvedNavItem(item);
  if (!visible || !item.href) return null;

  const href = item.href;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-nav-item=""
      // `h-auto` and `whitespace-normal` undo the variant's fixed height and
      // no-wrap, so a long link label wraps inside its chip instead of running
      // out of the card. `min-h-8` keeps the chip a comfortable target when the
      // label is short. The last-child rule shrinks the trailing mark below the
      // button variant's own `[&_svg]:size-4`, which a plain `size-3.5` on the
      // icon cannot beat: the variant's selector is the more specific of the two.
      className="h-auto min-h-8 max-w-full justify-start gap-2 whitespace-normal py-1.5 text-left [&>svg:last-child]:size-3.5 [&>svg:last-child]:opacity-60"
      onClick={() => openExternal(href)}
    >
      {Icon ? <Icon size={16} /> : <ExternalLink size={16} />}
      <span className="min-w-0 break-words">{label}</span>
      {/* Says the chip leaves the app, which the link's own icon does not: a
          profile can pick `book` or `calendar` for something that is still a
          jump to the browser. Same mark the tool card puts on an external item. */}
      <ExternalLink size={16} />
    </Button>
  );
}

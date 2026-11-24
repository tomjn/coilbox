import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";
import { useTrustedHubUrl } from "@/hub/config";
import { ChatMapCard } from "./ChatMapCard";
import { ChatLinkCard, HubCard } from "./ChatSiteCard";
import { firstWebLink, linkCardsIn } from "./linkCards";

/**
 * The cards under a chat message for its links (issues #284 and #5436). A link
 * to a known site gets that site's card, built from the link alone. Any other
 * web link gets the card the hub fetched for it. Draws nothing for a message
 * with no link, or one the hub has no card for.
 *
 * A site's card is a button that hands the link to the OS browser, as the inline
 * link does. It is never an iframe. A map's card has buttons of its own, so it
 * is a different shape (`ChatMapCard`).
 */
export function ChatLinkCards({
  text,
  own,
}: {
  text: string;
  /** Own messages sit on the right, so their card does too. */
  own: boolean;
}) {
  // Most lines have no link, and those need no parse and no hub setting.
  if (!text.includes("://")) return null;
  return <LinkCards text={text} own={own} />;
}

function LinkCards({ text, own }: { text: string; own: boolean }) {
  const hubUrl = useTrustedHubUrl();
  const cards = linkCardsIn(text, hubUrl);
  if (cards.length === 0) {
    // A link no known site claims gets the hub's card (issue #5436), and a
    // profile with the hub switched off asks it nothing.
    const href = hubUrl ? firstWebLink(text) : null;
    return href && hubUrl ? (
      <HubCard
        key={`${hubUrl}\n${href}`}
        hubUrl={hubUrl}
        href={href}
        wrap={(card) => <Cards own={own}>{card}</Cards>}
      />
    ) : null;
  }
  return (
    <Cards own={own}>
      {cards.map((card) =>
        "map" in card ? (
          <ChatMapCard key={card.url} card={card} />
        ) : (
          <ChatLinkCard
            key={card.url}
            url={card.url}
            site={card.site}
            picture={card.thumbnail}
          />
        ),
      )}
    </Cards>
  );
}

function Cards({ own, children }: { own: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-1 flex flex-col gap-1",
        own ? "items-end" : "items-start",
      )}
    >
      {children}
    </div>
  );
}

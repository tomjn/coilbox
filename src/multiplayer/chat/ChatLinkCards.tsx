import { cn } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTrustedHubUrl } from "@/hub/config";
import { ChatMapCard } from "./ChatMapCard";
import { linkCardsIn, type SiteLinkCard } from "./linkCards";

/**
 * The cards under a chat message for its links to known sites (issue #284).
 * Draws nothing for a message with no such link.
 *
 * A site's card is a button that hands the link to the OS browser, as the inline
 * link does. It is never an iframe. The picture is the only thing fetched. A map's
 * card has buttons of its own, so it is a different shape (`ChatMapCard`).
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
  if (cards.length === 0) return null;
  return (
    <div
      className={cn(
        "mt-1 flex flex-col gap-1",
        own ? "items-end" : "items-start",
      )}
    >
      {cards.map((card) =>
        "map" in card ? (
          <ChatMapCard key={card.url} card={card} />
        ) : (
          <ChatLinkCard key={card.url} card={card} />
        ),
      )}
    </div>
  );
}

function ChatLinkCard({ card }: { card: SiteLinkCard }) {
  // A picture that fails to load (offline, blocked, removed video) is dropped
  // rather than left as a broken-image icon. The card still opens the link.
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      data-link-card=""
      className="w-64 max-w-full overflow-hidden rounded-lg border bg-muted text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => {
        openUrl(card.url).catch(() => {});
      }}
    >
      {card.thumbnail && !failed && (
        // `no-referrer` so the third party is not told which page or lobby the
        // message was read in. `alt=""` because the text below names the link.
        <img
          src={card.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="aspect-video w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="flex items-center gap-2 px-2 py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{card.site}</span>
          <span className="block truncate text-muted-foreground text-xs">
            {card.url}
          </span>
        </span>
        <ExternalLink className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </span>
    </button>
  );
}

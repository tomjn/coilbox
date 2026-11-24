import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type HubLinkCard, heldLinkCard, hubLinkCard } from "@/hub/linkCard";

/**
 * The hub's card for a link (issue #5436). It asks only once the message is on
 * screen, so opening a long log does not ask about every link in it at once
 * against the hub's rate limit.
 *
 * Until the hub answers with a card, and for good when it has none, it draws
 * `fallback`, or nothing.
 */
export function HubCard({
  hubUrl,
  href,
  site,
  fallback = null,
  wrap = (card) => card,
}: {
  hubUrl: string;
  href: string;
  /** A name for the site that beats the hub's, such as "Coilbox Hub". */
  site?: string;
  fallback?: ReactNode;
  /** Wraps the card once there is one, so a caller's spacing does not show
   *  around nothing. */
  wrap?: (card: ReactNode) => ReactNode;
}) {
  const [card, setCard] = useState<HubLinkCard | null>(
    () => heldLinkCard(hubUrl, href) ?? null,
  );
  const watched = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (heldLinkCard(hubUrl, href) !== undefined) return;
    let live = true;
    const ask = () => {
      hubLinkCard(hubUrl, href).then((answer) => {
        if (live) setCard(answer);
      });
    };
    const target = watched.current;
    if (typeof IntersectionObserver === "undefined" || !target) {
      ask();
      return () => {
        live = false;
      };
    }
    const watcher = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watcher.disconnect();
      ask();
    });
    watcher.observe(target);
    return () => {
      live = false;
      watcher.disconnect();
    };
  }, [hubUrl, href]);

  if (!card) return <div ref={watched}>{fallback}</div>;
  return wrap(
    <ChatLinkCard
      url={href}
      site={site ?? card.siteName}
      picture={card.image}
      title={card.title}
      description={card.description}
    />,
  );
}

/**
 * A card that hands its link to the OS browser, as the inline link does. It is
 * never an iframe.
 */
export function ChatLinkCard({
  url,
  site,
  picture,
  title,
  description,
}: {
  /** The link as the sender typed it, which is what opens. */
  url: string;
  site: string;
  picture: string | null;
  /** The page's own title and description, when the hub found them. */
  title?: string;
  description?: string | null;
}) {
  // A picture that fails to load (offline, blocked, removed video) is dropped
  // rather than left as a broken-image icon. The card still opens the link.
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      data-link-card=""
      className="w-64 max-w-full cursor-pointer overflow-hidden rounded-lg border bg-muted text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => {
        openUrl(url).catch(() => {});
      }}
    >
      {picture && !failed && (
        // `no-referrer` so the third party is not told which page or lobby the
        // message was read in. `alt=""` because the text below names the link.
        <img
          src={picture}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="aspect-video w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="flex items-center gap-2 px-2 py-1.5">
        {title ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-muted-foreground text-xs">
              {site}
            </span>
            <span className="line-clamp-2 font-medium">{title}</span>
            {description && (
              <span className="line-clamp-2 text-muted-foreground text-xs">
                {description}
              </span>
            )}
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{site}</span>
            <span className="block truncate text-muted-foreground text-xs">
              {url}
            </span>
          </span>
        )}
        <ExternalLink className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </span>
    </button>
  );
}

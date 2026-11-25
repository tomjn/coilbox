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
 * An animation drawn in place, such as a GIF from Giphy, at most 200 pixels
 * high. Clicking it opens the link. If the animation fails to load, the site's
 * name is left as a plain card so the link still opens.
 */
export function ChatAnimationCard({
  url,
  site,
  animation,
}: {
  url: string;
  site: string;
  animation: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ChatLinkCard url={url} site={site} picture={null} />;
  return (
    <button
      type="button"
      data-link-card=""
      className="block max-w-full cursor-pointer overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => {
        openUrl(url).catch(() => {});
      }}
    >
      {/* `no-referrer` so the site is not told where the message was read. */}
      <img
        src={animation}
        alt={site}
        decoding="async"
        referrerPolicy="no-referrer"
        className="block h-auto max-h-[200px] w-auto max-w-full"
        onError={() => setFailed(true)}
      />
    </button>
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
  const open = () => {
    openUrl(url).catch(() => {});
  };
  // `no-referrer` so the third party is not told which page or lobby the
  // message was read in. `alt=""` because the text beside it names the link.
  const image = (className: string) =>
    picture &&
    !failed && (
      <img
        src={picture}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={className}
        onError={() => setFailed(true)}
      />
    );

  if (title) {
    // A page's own card, laid out as Discord lays out an embed: the text first,
    // then the picture at its own shape, since Open Graph pictures are wider
    // than a video and often carry text that cropping would cut. A square or
    // tall picture is held to a height rather than filling the width.
    return (
      <button
        type="button"
        data-link-card=""
        className="block w-md max-w-full cursor-pointer overflow-hidden rounded-md border border-l-4 border-l-primary bg-muted p-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        onClick={open}
      >
        <span className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="min-w-0 flex-1 truncate">{site}</span>
          <ExternalLink className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </span>
        <span className="mt-0.5 line-clamp-2 font-semibold text-primary">
          {title}
        </span>
        {description && (
          <span className="mt-1 line-clamp-4">{description}</span>
        )}
        {image("mt-3 h-auto max-h-80 w-auto max-w-full rounded")}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-link-card=""
      className="w-64 max-w-full cursor-pointer overflow-hidden rounded-lg border bg-muted text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={open}
    >
      {image("aspect-video w-full object-cover")}
      <span className="flex items-center gap-2 px-2 py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{site}</span>
          <span className="block truncate text-muted-foreground text-xs">
            {url}
          </span>
        </span>
        <ExternalLink className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </span>
    </button>
  );
}

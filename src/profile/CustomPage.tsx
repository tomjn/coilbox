import { cn } from "@picoframe/frame";
import type { FramePlugin, FrameRoute } from "@picoframe/plugin-sdk";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { useNavigate } from "react-router";
import { assetUrl, isLocalRef, mediaKind } from "../lib/assetUrl";
import { classifyMarkdownLink } from "./pageLinks";
import { buildPageNav, getProfilePages, type ProfilePage } from "./pages";
import { splitWidgets } from "./pageWidgets";
import { getProfileRoot } from "./profile";
import { PageWidget } from "./widgets";

/**
 * Renders a custom distribution page (issue #255) as Markdown, with an optional
 * background image. The content is bundler-authored and therefore trusted — but
 * `react-markdown` is safe-by-default (no raw HTML), which is plenty here, so we don't
 * pull in `rehype-raw`. Relative media/background refs are `.coilbox`-relative (the
 * same convention as the splash/logo/welcome assets) and load through the `coilbox://`
 * protocol; `data:`/`http(s):` refs are used verbatim.
 */

/** Resolve a page asset ref to a URL, mapping `.coilbox`-relative refs to the protocol. */
function resolveSrc(src: unknown): string | undefined {
  if (typeof src !== "string" || !src) return undefined;
  return isLocalRef(src) ? assetUrl(src) : src;
}

/**
 * Show a page's bundled file in the OS file manager, with the folder open and the
 * file selected.
 *
 * Somebody who writes `[our logo](@.coilbox/images/logo.webp)` rather than the
 * `!` image spelling means "click this to get at the file", so the click should
 * lead somewhere. The file manager rather than the file's own viewer because
 * `revealItemInDir` is already granted app-wide by `opener:default`, whereas
 * `openPath` is scope-limited to `$APPDATA` and a `.coilbox` folder sits beside
 * the executable instead. Opening the file itself is issue #1786.
 *
 * Off the portable path there is no folder to point at, so the click says which
 * link it was and stops: a click that silently does nothing is its own puzzle for
 * the author who wrote the page.
 */
function revealAsset(path: string) {
  const root = getProfileRoot();
  if (!root) {
    console.warn(
      `profile: ignored a link to "${path}", because this install has no .coilbox folder to find it in.`,
    );
    return;
  }
  revealItemInDir(`${root}/${path.replace(/^\.?\//, "")}`).catch((err) =>
    console.warn(`profile: could not show the file "${path}"`, err),
  );
}

/**
 * Renders a markdown link with the page-link scheme applied (issue #274): external URLs
 * open in the system browser (never navigating the webview away from the app), `.md` /
 * `@route/` / app-absolute links navigate in-app via the router, a `@.coilbox` asset is
 * shown in the OS file manager (see {@link revealAsset}), and a `@widget/`/malformed ref
 * renders inert (plain text) so a bad link can't break the page.
 */
function MarkdownLink({
  href,
  title,
  children,
}: {
  href?: string;
  title?: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const target = classifyMarkdownLink(href);
  if (target.kind === "inert") {
    return <span title={href}>{children}</span>;
  }
  if (target.kind === "anchor") {
    return (
      <a href={target.href} title={title}>
        {children}
      </a>
    );
  }
  if (target.kind === "asset") {
    return (
      <a
        href={target.url}
        title={title}
        onClick={(e) => {
          // Never let the webview follow this one. A `coilbox://` URL is a file,
          // so following it draws the file over the whole app with no back button
          // and no address bar, and only a restart brings Coilbox back (issue
          // #1783). The same stranding was fixed for distribution markup in #1062
          // and #1777.
          e.preventDefault();
          revealAsset(target.path);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={target.kind === "external" ? target.url : target.to}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        if (target.kind === "external") {
          openUrl(target.url).catch((err) =>
            console.warn("profile: could not open link", err),
          );
        } else {
          navigate(target.to);
        }
      }}
    >
      {children}
    </a>
  );
}

const MEDIA_COMPONENTS: Components = {
  a: MarkdownLink,
  img({ src, alt, title }) {
    const url = resolveSrc(src);
    if (!url) return null;
    const kind = mediaKind(url);
    if (kind === "audio") {
      // biome-ignore lint/a11y/useMediaCaption: bundler-supplied page audio has no caption track
      return <audio controls src={url} className="my-3 w-full" />;
    }
    if (kind === "video") {
      return (
        // biome-ignore lint/a11y/useMediaCaption: bundler-supplied page video has no caption track
        <video
          controls
          src={url}
          className="my-3 w-full rounded-md"
          title={title}
        />
      );
    }
    return (
      <img
        src={url}
        alt={alt ?? ""}
        title={title}
        className="my-3 max-w-full rounded-md"
      />
    );
  },
};

/** Themed typography for a run of markdown prose. */
const PROSE_CLASSES = cn(
  "text-sm leading-relaxed text-foreground/90",
  "[&_a]:text-primary [&_a]:underline",
  "[&_code]:font-mono [&_code]:text-xs",
  "[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-semibold",
  "[&_li]:ml-4 [&_li]:list-disc [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2",
  "[&_ol_li]:list-decimal",
);

/**
 * Markdown page body with themed typography, inline media, and embedded `@widget/...`
 * tokens (issue #274). The body is split into prose/widget segments: prose runs through
 * react-markdown with the {@link PROSE_CLASSES} typography, widgets render bare (their
 * own components own their styling) between the prose. The no-widget case renders exactly
 * as before — a single prose block.
 */
function PageProse({ children }: { children: string }) {
  const segments = splitWidgets(children);
  if (segments.length === 1 && segments[0].kind === "text") {
    return (
      <div className={PROSE_CLASSES}>
        <Markdown components={MEDIA_COMPONENTS}>{segments[0].text}</Markdown>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments derive from a static body and never reorder
          <div key={i} className={PROSE_CLASSES}>
            <Markdown components={MEDIA_COMPONENTS}>{seg.text}</Markdown>
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments derive from a static body and never reorder
          <PageWidget key={i} name={seg.name} arg={seg.arg} />
        ),
      )}
    </div>
  );
}

/** One custom page: an optional full-bleed background behind a centered prose column. */
export function MarkdownPage({ page }: { page: ProfilePage }) {
  const bg = resolveSrc(page.background);
  return (
    <div className="relative min-h-full">
      {bg && (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${bg})` }}
          aria-hidden
        />
      )}
      <article
        className={cn(
          "relative mx-auto my-8 max-w-3xl rounded-lg px-6 py-8",
          // A translucent scrim keeps the prose readable over any background image.
          bg && "bg-background/80 shadow-sm backdrop-blur-sm",
        )}
      >
        <PageProse>{page.body}</PageProse>
      </article>
    </div>
  );
}

/**
 * Build a frame route per page. Each route's `lazy` resolves immediately to a
 * component bound (via closure) to its already-loaded page — there's nothing to fetch
 * on navigation, but the frame's API is lazy, so we hand back a resolved promise.
 */
export function buildPageRoutes(pages: ProfilePage[]): FrameRoute[] {
  return pages.map((page) => ({
    path: page.route,
    crumb: page.title,
    lazy: async () => ({ default: () => <MarkdownPage page={page} /> }),
  }));
}

/**
 * Inject the profile's custom pages into the `profile` plugin as routes + sidebar nav.
 * Called from `main.tsx` after `loadProfilePages()` resolves (the plugin list is built
 * before the pages load). Mirrors `applyProfileLinks`. No-op — returns the same array —
 * when there are no pages, so vanilla Coilbox is untouched.
 */
export function applyProfilePages(plugins: FramePlugin[]): FramePlugin[] {
  const pages = getProfilePages();
  if (pages.length === 0) return plugins;
  const routes = buildPageRoutes(pages);
  const nav = buildPageNav(pages);
  return plugins.map((p) =>
    p.id === "profile"
      ? {
          ...p,
          routes: [...p.routes, ...routes],
          nav: [...(p.nav ?? []), ...nav],
        }
      : p,
  );
}

import { cn } from "@picoframe/frame";
import Markdown, { type Components } from "react-markdown";
import { assetUrl, isLocalRef, mediaKind } from "../../../lib/assetUrl";
import { externalOnlyLink } from "../../../lib/MarkdownLink";

/**
 * Renders a mission/campaign briefing as Markdown. Unlike the profile welcome screen
 * (trusted, bundler-authored raw HTML), a campaign is imported from other users and
 * therefore **untrusted** — so this uses `react-markdown`, which is safe by default
 * (no raw HTML, URL-sanitised links). We deliberately do NOT add `rehype-raw`.
 *
 * Inline media works without raw HTML via a custom `img` renderer: a Markdown image
 * whose source is an audio/video file renders an `<audio>`/`<video>` player instead
 * of an `<img>`. Relative sources resolve against the portable `.coilbox/` folder
 * through the `coilbox://` protocol (so `![](images/x.jpg)` or `![](briefings/vo.ogg)`
 * loads a bundled file); absolute/data URLs are used verbatim.
 */

/** Resolve a Markdown media source to a URL, mapping local refs to the asset protocol. */
function resolveSrc(src: unknown): string | undefined {
  if (typeof src !== "string" || !src) return undefined;
  return isLocalRef(src) ? assetUrl(src) : src;
}

const MEDIA_COMPONENTS: Components = {
  // A briefing's links are the campaign author's, not Coilbox's, so a click hands
  // an `https:` link to the browser and refuses the rest rather than letting the
  // webview follow it out of the app (issue #1789).
  a: externalOnlyLink("campaign"),
  img({ src, alt, title }) {
    const url = resolveSrc(src);
    if (!url) return null;
    const kind = mediaKind(url);
    if (kind === "audio") {
      // biome-ignore lint/a11y/useMediaCaption: author-supplied briefing audio has no caption track
      return <audio controls src={url} className="my-2 w-full" />;
    }
    if (kind === "video") {
      return (
        // biome-ignore lint/a11y/useMediaCaption: author-supplied briefing video has no caption track
        <video
          controls
          src={url}
          className="my-2 max-h-80 w-full rounded-md"
          title={title}
        />
      );
    }
    return (
      <img
        src={url}
        alt={alt ?? ""}
        title={title}
        className="my-2 max-w-full rounded-md"
      />
    );
  },
};

/** Markdown briefing body with themed typography and inline media. */
export function BriefingProse({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-foreground/90",
        "[&_a]:text-primary [&_a]:underline",
        "[&_code]:font-mono [&_code]:text-xs",
        "[&_h1]:mt-2 [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:font-semibold",
        "[&_li]:ml-4 [&_li]:list-disc [&_p]:my-1 [&_ul]:my-1",
        className,
      )}
    >
      <Markdown components={MEDIA_COMPONENTS}>{children}</Markdown>
    </div>
  );
}

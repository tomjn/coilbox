import { Trans } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import {
  assetUrl,
  campaignMediaUrl,
  isLocalRef,
  markdownFilePath,
  mediaKind,
} from "../../../lib/assetUrl";
import { externalOnlyLink } from "../../../lib/MarkdownLink";
import { GFM_PLUGINS, GFM_PROSE_CLASSES } from "../../../lib/markdownGfm";
import { briefingFileName } from "../../briefingFiles";
import {
  type CampaignGameOrigin,
  gameCampaignFileUrl,
} from "../../gameCampaigns";
import type { ImageRef } from "../../model";

/**
 * Renders a mission/campaign briefing as Markdown. Unlike the profile welcome screen
 * (trusted, bundler-authored raw HTML), a campaign is imported from other users and
 * therefore **untrusted** — so this uses `react-markdown`, which is safe by default
 * (no raw HTML, URL-sanitised links). We deliberately do NOT add `rehype-raw`.
 *
 * Inline media works without raw HTML via a custom `img` renderer: a Markdown image
 * whose source is an audio/video file renders an `<audio>`/`<video>` player instead
 * of an `<img>`. Absolute URLs are used verbatim. A relative source in a bundled
 * campaign resolves against the portable `.coilbox/` folder through the
 * `coilbox://` protocol (so `![](images/x.jpg)` loads a bundled file). In a
 * campaign shipped inside a game it names a file beside that campaign's
 * `campaign.json`, read out of the game's archive (issue #5468). A file the
 * campaign carries itself, as a copy of a game's campaign does, comes before both
 * (issue #5484)
 */

/** Where the briefing's relative file names are looked up */
interface Source {
  campaignId?: string;
  /** Set for a campaign shipped inside a game */
  gameOrigin?: CampaignGameOrigin;
  /** The files the campaign carries, by the name the Markdown uses */
  files?: Record<string, ImageRef>;
}

const BriefingSource = createContext<Source>({});

/** The URL of a carried file, or `undefined` to look the name up elsewhere */
function carriedUrl(
  { campaignId, gameOrigin, files }: Source,
  name: string,
): string | undefined {
  if (!files || !Object.hasOwn(files, name)) return undefined;
  const ref = files[name];
  if (ref.kind === "data") return ref.dataUri;
  if (ref.kind === "local") return assetUrl(ref.path);
  // A game's document naming a file means one in the game.
  return campaignId && !gameOrigin
    ? campaignMediaUrl(campaignId, ref.file)
    : undefined;
}

type Kind = ReturnType<typeof mediaKind>;

/**
 * `kind` is decided by the caller, since the `blob:` URL of a file read out of
 * an archive has no extension to tell by.
 */
function InlineMedia({
  url,
  kind,
  alt,
  title,
}: {
  url: string;
  kind: Kind;
  alt?: string;
  title?: string;
}) {
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
}

/** One inline file of a game campaign, which has to be read out of the archive */
function GameMedia({
  origin,
  file,
  alt,
  title,
}: {
  origin: CampaignGameOrigin;
  file: string;
  alt?: string;
  title?: string;
}) {
  const [read, setRead] = useState<{ url: string } | "failed">();

  useEffect(() => {
    let cancelled = false;
    setRead(undefined);
    gameCampaignFileUrl(origin, file)
      .then((url) => {
        if (!cancelled) setRead({ url });
      })
      .catch((e) => {
        console.warn("could not read briefing media from its game", file, e);
        if (!cancelled) setRead("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [origin, file]);

  if (read === "failed") {
    return (
      <span className="my-2 block text-xs text-muted-foreground">
        <Trans>Could not load {file} from the game</Trans>
      </span>
    );
  }
  if (!read) {
    return (
      <span
        role="status"
        className="my-2 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <Trans>Loading {file}…</Trans>
      </span>
    );
  }
  return (
    <InlineMedia
      url={read.url}
      kind={mediaKind(file)}
      alt={alt}
      title={title}
    />
  );
}

function BriefingImage({
  src,
  alt,
  title,
}: {
  src?: unknown;
  alt?: string;
  title?: string;
}) {
  const source = useContext(BriefingSource);
  const origin = source.gameOrigin;
  if (typeof src !== "string" || !src) return null;
  if (isLocalRef(src)) {
    const name = briefingFileName(src);
    const url = carriedUrl(source, name);
    if (url) {
      return (
        <InlineMedia url={url} kind={mediaKind(name)} alt={alt} title={title} />
      );
    }
  }
  if (origin && isLocalRef(src)) {
    const file = briefingFileName(src);
    return (
      <GameMedia
        key={file}
        origin={origin}
        file={file}
        alt={alt}
        title={title}
      />
    );
  }
  const url = isLocalRef(src) ? assetUrl(markdownFilePath(src)) : src;
  return (
    <InlineMedia url={url} kind={mediaKind(url)} alt={alt} title={title} />
  );
}

const MEDIA_COMPONENTS: Components = {
  // A briefing's links are the campaign author's, not Coilbox's, so a click hands
  // an `https:` link to the browser and refuses the rest rather than letting the
  // webview follow it out of the app (issue #1789).
  a: externalOnlyLink("campaign"),
  img: ({ src, alt, title }) => (
    <BriefingImage src={src} alt={alt} title={title} />
  ),
};

/** Markdown briefing body with themed typography and inline media */
export function BriefingProse({
  children,
  className,
  campaignId,
  gameOrigin,
  files,
}: Source & {
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
        GFM_PROSE_CLASSES,
        className,
      )}
    >
      <BriefingSource.Provider value={{ campaignId, gameOrigin, files }}>
        <Markdown components={MEDIA_COMPONENTS} remarkPlugins={GFM_PLUGINS}>
          {children}
        </Markdown>
      </BriefingSource.Provider>
    </div>
  );
}

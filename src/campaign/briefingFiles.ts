/**
 * The files a briefing's Markdown names (issue #5484).
 *
 * A game's campaign keeps them beside its `campaign.json`, so the briefing text
 * only names them. A copy or an export is no longer inside the game, so it lists
 * each one in `Campaign.briefingFiles` under the name the text uses, and the
 * text stays as the author wrote it.
 */

import Markdown, { defaultUrlTransform } from "react-markdown";
import { isLocalRef, markdownFilePath } from "../lib/assetUrl";
import { GFM_PLUGINS } from "../lib/markdownGfm";
import { gameCampaignOrigin } from "./gameCampaigns";
import type { Campaign, ImageRef } from "./model";

/** The file a relative image source in a briefing names. */
export function briefingFileName(src: string): string {
  return markdownFilePath(src.startsWith("./") ? src.slice(2) : src);
}

/**
 * Every file a briefing shows or plays. Read by the renderer's own parser, so
 * this and the briefing screen cannot disagree about what is a file.
 */
function namedFiles(markdown: string): string[] {
  const names: string[] = [];
  Markdown({
    children: markdown,
    remarkPlugins: GFM_PLUGINS,
    urlTransform: (url, key) => {
      const safe = defaultUrlTransform(url);
      if (key === "src" && safe && isLocalRef(safe)) {
        names.push(briefingFileName(safe));
      }
      return safe;
    },
  });
  return names;
}

/**
 * `campaign` with every file its briefings take from its game listed in
 * `briefingFiles`. A campaign that is not a game's comes back as it is: its
 * relative names point into the `.coilbox` folder, where they stay.
 */
export function withBriefingFileRefs(campaign: Campaign): Campaign {
  if (!gameCampaignOrigin(campaign.id)) return campaign;
  const files = new Map<string, ImageRef>(
    campaign.missions
      .flatMap((m) => namedFiles(m.briefing))
      .map((file) => [file, { kind: "file", file }]),
  );
  // What the document already carries wins over the game's folder.
  for (const [name, ref] of Object.entries(campaign.briefingFiles ?? {})) {
    files.set(name, ref);
  }
  if (files.size === 0) return campaign;
  return { ...campaign, briefingFiles: Object.fromEntries(files) };
}

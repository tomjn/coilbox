import { defineCommand } from "@picoframe/plugin-sdk";
import {
  asContainer,
  decodeContainerText,
  identify,
  makeContainer,
} from "@/container/container";
import { MAX_IMPORT_BYTES } from "@/deeplink/fetchImport";
import {
  COLD_START,
  HUB_KINDS,
  type HubItemDetail,
  type HubResult,
  readItemBody,
  serverError,
} from "./api";

/**
 * The write half of the Coilbox hub API (issue #1349): `POST /api/v1/items`,
 * which takes a share code plus the words that go with it and answers with the
 * stored item and a link to it.
 *
 * Unlike the read half in `./api`, the request itself is made in Rust
 * (`hub_publish`, in the `coilbox-hub` plugin). That is where the access token
 * lives and no token crosses the IPC boundary, so the webview hands over what to
 * publish and gets back what the hub answered. Everything else - what is worth
 * sending, and what the hub's answer means in words - is here, beside the read
 * half's own vocabulary rather than in a second copy of it in Rust.
 */

/** What a publication is made of, as the drawer collects it. */
export interface Publication {
  code: string;
  title: string;
  description: string;
  /** Already split. Trimming, lowercasing and the cap on how many are the hub's
   * rules, applied on its side, so they are not repeated here. */
  tags: string[];
}

/**
 * Split the tags field. One text box rather than a tag widget, because that is
 * what the hub's own form takes, and it hands the whole string over: what counts
 * as a tag is a publishing rule and only the hub should hold it.
 */
export function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

/**
 * Why this cannot be published, or null when it can.
 *
 * The hub checks all of this too, in `accept()` and `publishItem`, and its
 * wording is reused here on purpose. This is not a second opinion: it is the same
 * rules applied before a round trip, because being told a campaign cannot be
 * published after waiting for a sleeping server is a worse way to learn it. The
 * container code the hub vendors is coilbox's own, so both sides are reading the
 * same `identify()`.
 */
export function whyNotPublishable(publication: Publication): string | null {
  const code = publication.code.trim();
  if (code === "") return "There is nothing to publish yet.";

  const found = identify(code);
  if (found.kind === "unknown") {
    return "That is not something coilbox made, so the hub will not take it.";
  }
  if (!(HUB_KINDS as readonly string[]).includes(found.kind)) {
    return `The hub does not carry ${found.kind}s yet.`;
  }

  // The ceiling the hub enforces, measured the way it measures it: on the
  // container's JSON, not on the code, which is compressed and much shorter.
  const decoded = decodeContainerText(code);
  if (decoded === null) return "That share code could not be read.";
  const container =
    asContainer(decoded) ??
    makeContainer(found.kind, found.version || 1, decoded);
  const size = new TextEncoder().encode(JSON.stringify(container)).byteLength;
  if (size > MAX_IMPORT_BYTES) {
    return "This is too large to share. Coilbox would refuse to import it.";
  }

  if (publication.title.trim() === "") {
    return "Give it a title so people know what it is.";
  }
  return null;
}

/**
 * The hub's answer, passed through from Rust rather than judged there. `body` is
 * whatever JSON came back, or null when it was not JSON at all.
 */
interface PublishAnswer {
  status: number;
  body: unknown;
}

/**
 * Publish as whoever is signed in to this hub. Rejects when there is no usable
 * sign-in or the hub was never reached, both already worded as sentences.
 */
const hubPublish = defineCommand<
  {
    hubUrl: string;
    code: string;
    title: string;
    description: string;
    tags: string[];
  },
  PublishAnswer
>("coilbox-hub", "hub_publish");

/**
 * Turn a refused publish into a sentence.
 *
 * Two of these are the failures that will actually happen. A 429 is the hub's
 * rate limit, which is a database trigger and arrives as a message about a
 * failed insert, so it is named here as the hourly cap it is. A 5xx is most
 * often the free tier waking up, which is the same {@link COLD_START} the read
 * side already says rather than a second wording of it.
 */
export function publishFailureMessage(status: number, body: unknown): string {
  const said = serverError(body);
  if (status === 401) {
    return "The hub would not accept your sign-in. Sign out and back in under Settings > Coilbox hub, then try again.";
  }
  if (status === 429) {
    return "This account has published 20 things in the last hour, which is the hub's limit. Try again later.";
  }
  if (status >= 500) {
    return `${said ?? "The hub could not publish it."} ${COLD_START}`;
  }
  return said ?? `The hub refused that request (HTTP ${status}).`;
}

/**
 * Publish a share code to the hub, and hand back the item it became. Never
 * throws: everything, including a rejected sign-in, comes back as a sentence
 * meant to be shown as-is.
 */
export async function publishToHub(
  hubUrl: string,
  publication: Publication,
): Promise<HubResult<HubItemDetail>> {
  const refusal = whyNotPublishable(publication);
  if (refusal) return { ok: false, reason: refusal };

  let answer: PublishAnswer;
  try {
    answer = await hubPublish({
      hubUrl,
      code: publication.code.trim(),
      title: publication.title.trim(),
      description: publication.description.trim(),
      tags: publication.tags,
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  if (answer.status < 200 || answer.status >= 300) {
    return {
      ok: false,
      reason: publishFailureMessage(answer.status, answer.body),
    };
  }
  return readItemBody(answer.body);
}

/**
 * Where a published item's page lives on the hub itself, for opening in a
 * browser. `/i/<id>` is the container an import fetches, while this is the page
 * a person reads, and the one the website's own cards link to.
 */
export function hubItemPageUrl(base: string, id: string): string {
  return `${base.replace(/\/+$/, "")}/item/${encodeURIComponent(id)}`;
}

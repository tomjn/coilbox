import { describe, expect, it } from "vitest";
import type { ArchiveUploadOutcome } from "../archiveUploads";
import { describeUploadEnd } from "./messages";

const LINKS = {
  listed: "https://hub.test/map/tabula-3",
  game: "https://hub.test/games/sf",
};

function stopped(
  code: string,
  source: "hub" | "mirror" | "local" = "hub",
  extra: Partial<Extract<ArchiveUploadOutcome, { kind: "stopped" }>> = {},
): ArchiveUploadOutcome {
  return {
    kind: "stopped",
    source,
    code,
    status: null,
    said: `English for ${code}`,
    ...extra,
  };
}

describe("what a player is told when an upload ends", () => {
  it("says it is listed and links the hub page", () => {
    const said = describeUploadEnd({ kind: "listed" }, "Tabula 3", LINKS);
    expect(said.level).toBe("success");
    expect(said.title).toBe("Tabula 3 is on the hub");
    expect(said.link).toEqual({ url: LINKS.listed, label: "Show on hub" });
  });

  it("still says it is listed when the hub gave no page", () => {
    const said = describeUploadEnd({ kind: "listed" }, "Tabula 3", {
      listed: null,
      game: null,
    });
    expect(said.link).toBeUndefined();
  });

  it("says a stop keeps what the mirror received", () => {
    const said = describeUploadEnd({ kind: "cancelled" }, "Tabula 3", LINKS);
    expect(said.body).toContain("carries on from there");
    expect(said.retry).toBe(true);
  });

  it("names which check matched on a duplicate, and links the existing page", () => {
    const duplicate = (check: string | null) =>
      describeUploadEnd(
        stopped("duplicate", "hub", {
          duplicate: {
            check,
            filename: "tabula.sd7",
            kind: "map",
            state: "listed",
            url: "https://hub.test/map/tabula",
          },
        }),
        "Tabula 3",
        LINKS,
      );
    expect(duplicate("sha256").body).toContain("same contents");
    expect(duplicate("filename").body).toContain("same name");
    expect(duplicate("name_version").body).toContain("name and version");
    expect(duplicate(null).body).toBe("The hub already has this archive.");
    expect(duplicate("sha256").link?.url).toBe("https://hub.test/map/tabula");
    expect(duplicate("sha256").retry).toBe(false);
  });

  it("gives a duplicate with no page no link", () => {
    const said = describeUploadEnd(
      stopped("duplicate", "hub", {
        duplicate: {
          check: "filename",
          filename: null,
          kind: null,
          state: "pending",
          url: null,
        },
      }),
      "Tabula 3",
      LINKS,
    );
    expect(said.link).toBeUndefined();
  });

  it("tells a player who is not the owner how to ask to own the game", () => {
    const said = describeUploadEnd(stopped("not_owner"), "SF", LINKS);
    expect(said.body).toContain("Only the game's owner can upload it");
    expect(said.link).toEqual({
      url: LINKS.game,
      label: "Open the game on the hub",
    });
  });

  it("sends an unknown game to the send step first", () => {
    const said = describeUploadEnd(stopped("unknown_game"), "SF", LINKS);
    expect(said.body).toContain("Send it to the hub first");
    expect(said.sendFirst).toBe(true);
  });

  it("sends an unknown map to the send step first", () => {
    const said = describeUploadEnd(stopped("unknown_map"), "Tabula 3", LINKS);
    expect(said.body).toContain("Send it to the hub first");
    expect(said.sendFirst).toBe(true);
  });

  it.each([
    ["no_mirror", "hub"],
    ["unavailable", "hub"],
    ["not_configured", "hub"],
    ["uploads_disabled", "mirror"],
  ] as const)("says to try later when %s from the %s", (code, source) => {
    const said = describeUploadEnd(stopped(code, source), "Tabula 3", LINKS);
    expect(said.body).toContain("Try again later");
    expect(said.retry).toBe(true);
  });

  it("offers a retry when the file changed", () => {
    const said = describeUploadEnd(
      stopped("file_changed", "local"),
      "Tabula 3",
      LINKS,
    );
    expect(said.body).toContain("changed while it was uploading");
    expect(said.retry).toBe(true);
  });

  it("keeps a mirror's own copy apart from the hub's duplicate", () => {
    const exists = describeUploadEnd(
      stopped("exists", "mirror"),
      "Tabula 3",
      LINKS,
    );
    const duplicate = describeUploadEnd(
      stopped("duplicate", "hub"),
      "Tabula 3",
      LINKS,
    );
    expect(exists.body).toContain("the hub cannot list this one");
    expect(exists.retry).toBe(false);
    expect(exists.body).not.toBe(duplicate.body);
    expect(exists.title).toBe("Tabula 3 was not uploaded");
  });

  it("says a dropped connection that kept failing can be carried on", () => {
    const said = describeUploadEnd(
      stopped("unreachable", "local"),
      "Tabula 3",
      LINKS,
    );
    expect(said.retry).toBe(true);
    expect(said.body).toContain("carry on");
  });

  it("falls back to the English sentence for a code it does not know", () => {
    const said = describeUploadEnd(
      stopped("from_a_newer_hub"),
      "Tabula 3",
      LINKS,
    );
    expect(said.body).toBe("English for from_a_newer_hub");
    expect(said.level).toBe("error");
  });
});

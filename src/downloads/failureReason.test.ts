import { describe, expect, it } from "vitest";
import { describeFailure, stripSidecarPrefix } from "./failureReason";

const ctx = { host: "mirror2.example.com", filename: "Supreme_Isthmus_v2.sd7" };

describe("describeFailure", () => {
  it("names the host and file for a 404", () => {
    const raw =
      "HTTP status client error (404 Not Found) for url (https://mirror2.example.com/Supreme_Isthmus_v2.sd7)";
    expect(describeFailure(raw, ctx)).toBe(
      "mirror2.example.com answered 404 for Supreme_Isthmus_v2.sd7",
    );
  });

  it("names the status for other HTTP errors", () => {
    const raw =
      "HTTP status server error (503 Service Unavailable) for url (https://mirror2.example.com/x)";
    expect(describeFailure(raw, ctx)).toBe(
      "mirror2.example.com answered 503 for Supreme_Isthmus_v2.sd7",
    );
  });

  it("names the host and file for a timeout", () => {
    expect(describeFailure("The host took too long to respond.", ctx)).toBe(
      "mirror2.example.com did not answer in time for Supreme_Isthmus_v2.sd7",
    );
  });

  it("names the host and file for a stall, and keeps the time the app waited", () => {
    const raw =
      "Download stalled — no data received for 2 minutes. Check your connection or try a different mirror, then retry.";
    expect(describeFailure(raw, ctx)).toBe(
      "mirror2.example.com stopped sending Supreme_Isthmus_v2.sd7 for 2 minutes",
    );
  });

  it("names the host and file when the connection could not be made", () => {
    expect(
      describeFailure(
        "error sending request for url (https://mirror2.example.com/Supreme_Isthmus_v2.sd7)",
        ctx,
      ),
    ).toBe(
      "could not connect to mirror2.example.com for Supreme_Isthmus_v2.sd7",
    );
  });

  it("says 'the mirror' and 'the file' when it does not know which", () => {
    expect(
      describeFailure("HTTP status client error (404 Not Found) for url (x)", {
        host: null,
        filename: null,
      }),
    ).toBe("the mirror answered 404 for the file");
  });

  it("falls back to the sidecar's last line when nothing better is known", () => {
    const raw =
      "[Error] /Users/tomjn/dev/RecoilEngine/tools/pr-downloader/src/Downloader/Http/HttpDownloader.cpp:220:search():Error downloading https://springfiles.springrts.com/?category=map&springname=Isis";
    expect(describeFailure(raw, { host: null, filename: null })).toBe(
      "Error downloading https://springfiles.springrts.com/?category=map&springname=Isis",
    );
  });

  it("leaves a cancellation alone", () => {
    expect(describeFailure("Download cancelled.", ctx)).toBe(
      "Download cancelled.",
    );
  });
});

describe("stripSidecarPrefix", () => {
  it("removes the level, source path, line and function from each line", () => {
    const raw = [
      "[Error] /a b/src/Http.cpp:220:search():first",
      "[Warn] /c/Other.h:9:go():second",
    ].join("\n");
    expect(stripSidecarPrefix(raw)).toBe("first\nsecond");
  });

  it("leaves text without that prefix as it is", () => {
    expect(stripSidecarPrefix("no such tag")).toBe("no such tag");
  });
});

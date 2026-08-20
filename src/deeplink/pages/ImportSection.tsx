import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChallengeCodeInput } from "@/challenge/ChallengeCodeInput";
import { containerKindsSentence } from "@/container/names";
import { nextDrawerKey } from "@/general/drawerKey";
import { importContainerFile } from "../bindings";
import { dispatchDeepLink } from "../bus";
import { ConfirmDialog, type Pending } from "../ConfirmDialog";
import { clipboardOffer, readImport } from "../readImport";
import { useImportParam } from "../useImportParam";

/**
 * The one import box (issue #1333), the Settings > Import section: paste
 * anything coilbox produced and it works out what it is.
 *
 * Every other import route in coilbox assumes you already know what you are
 * holding, which somebody handed a link off a website does not. This takes a
 * `coilbox://` link of any shape, a bare share code, the text of an export, a
 * `.json` file, or a hub share's https address, names what it found, and then
 * hands it to the importer that kind already has. It imports nothing itself.
 *
 * It is the paste target for Coilbox Hub's copy button, which is what the hub
 * falls back to when a `coilbox://` link goes nowhere because the scheme has no
 * registered handler.
 *
 * The clipboard is offered, never taken. On arrival it has one look at the
 * clipboard, and only when it holds something coilbox recognises does it say so,
 * with a button. A read that fails or is refused leaves no trace: the box works
 * exactly as it would have.
 */
export default function ImportSection() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [offer, setOffer] = useState<{ text: string; line: string } | null>(
    null,
  );
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  // A fresh key for every arrival, so a form that already ran a code is never
  // handed the same code again (issue #1398). It is the same fragility, and
  // the same fix, as `nextDrawerKey` (see `../../general/drawerKey.ts`) gave
  // the hub and content drawers for issue #1395: a key derived from the code
  // itself cannot tell two arrivals of the same code apart.
  const [formKey, setFormKey] = useState(() => nextDrawerKey());

  // A campaign deep link lands here with the code in the query string, because
  // campaigns are the one recognised kind with no code importer.
  const importParams = useImportParam();
  // Remounting `ChallengeCodeInput` under a new key is what fills and submits
  // it, which is also how a deep-linked code reaches every other importer.
  const seed = chosen ?? importParams.code;

  // `importParams` is a fresh object only on a genuine new arrival (see
  // `useImportParam`), so this cannot miss a repeat of the same code the way
  // comparing the code string itself would.
  useEffect(() => {
    if (importParams.code !== undefined) setFormKey(nextDrawerKey());
  }, [importParams]);

  useEffect(() => {
    let cancelled = false;
    navigator.clipboard
      ?.readText()
      .then((text) => {
        if (cancelled) return;
        const line = clipboardOffer(text);
        if (line) setOffer({ text, line });
      })
      // Denied, empty, or unavailable. Say nothing about it either way. macOS
      // WKWebView refuses a read with no user gesture behind it
      // (NotAllowedError), so on macOS today this never gets as far as an
      // offer, which is exactly the no-op it is meant to be. Reading the
      // clipboard natively instead is issue #1344.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Throwing is how `ChallengeCodeInput` surfaces a message, so a rejection's
  // sentence lands in its error banner unchanged.
  const check = async (text: string) => {
    const result = readImport(text);
    if (result.outcome === "rejected") throw new Error(result.reason);
    if (result.outcome === "link") {
      // A join, an open, or an import that needs downloading first. The
      // deep-link handler owns those and confirms them itself.
      dispatchDeepLink(result.url);
      return;
    }
    const { plan, phrase } = result;
    setPending({
      title: `Import ${phrase}`,
      lines: [
        `This is ${phrase}. Import it?`,
        plan.detail ??
          "It opens in the importer, which resolves any missing content before saving.",
      ],
      warnings: plan.warnings,
      confirmLabel: "Continue",
      run: () => navigate(plan.route),
    });
  };

  const pickFile = async () => {
    const src = await open({
      title: "Open a coilbox file",
      multiple: false,
      filters: [{ name: "Coilbox file", extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const { text } = await importContainerFile({ src });
    return text;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Paste anything coilbox made and it will work out what it is. A coilbox
        link, a share code, the address of a share on the web, the contents of
        an exported file, or the file itself. Nothing is imported until you have
        seen what it is and said yes.
      </p>

      {offer && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <ClipboardPaste
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="grow">{offer.line}</span>
          <Button
            size="sm"
            onClick={() => {
              setChosen(offer.text);
              setFormKey(nextDrawerKey());
              setOffer(null);
            }}
          >
            Use it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Dismiss the clipboard offer"
            onClick={() => setOffer(null)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        <ChallengeCodeInput
          key={formKey}
          // The list is back, built from the kinds a container can hold rather
          // than written out (issue #1515). Written out is how it came to be
          // two kinds short, and how it stayed short until somebody counted.
          // A campaign is on it: pasting one here is answered with where a
          // campaign goes, which is this box doing its job rather than
          // refusing.
          helpText={`Anything coilbox shares goes here: ${containerKindsSentence()}.`}
          placeholder="Paste a coilbox link, a code, or an exported file's contents…"
          submitLabel="Import"
          busyLabel="Checking…"
          fileButtonLabel="Open a file instead…"
          initialCode={seed}
          onImport={check}
          onPickFile={pickFile}
        />
      </div>

      <ConfirmDialog pending={pending} setPending={setPending} />
    </div>
  );
}

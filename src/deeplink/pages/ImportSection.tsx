import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChallengeCodeInput } from "@/challenge/ChallengeCodeInput";
import { HelpPopover } from "@/components/HelpPopover";
import { Label } from "@/components/ui/label";
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
  const { t } = useLingui();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [offer, setOffer] = useState<{ text: string; line: string } | null>(
    null,
  );
  // The code the form is handed, from the clipboard offer or a deep link,
  // whichever came last.
  const [seed, setSeed] = useState<string | undefined>(undefined);
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
  // `importParams` is a fresh object only on a genuine new arrival (see
  // `useImportParam`), so this cannot miss a repeat of the same code the way
  // comparing the code string itself would.
  useEffect(() => {
    if (importParams.code === undefined) return;
    setSeed(importParams.code);
    setFormKey(nextDrawerKey());
  }, [importParams]);

  useEffect(() => {
    let cancelled = false;
    // Read through Tauri's clipboard plugin rather than the webview's
    // `navigator.clipboard`, which macOS WKWebView refuses with no user gesture
    // behind it (issue #1344). There is no webview fallback: the plugin works
    // on every platform coilbox ships, and the webview read can only fail where
    // the plugin would not.
    readText()
      .then((text) => {
        if (cancelled) return;
        const line = clipboardOffer(text);
        if (line) setOffer({ text, line });
      })
      // An empty clipboard, one holding an image, or a refused read. Say
      // nothing about it either way.
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
      title: t`Import ${phrase}`,
      lines: [
        t`This is ${phrase}. Import it?`,
        plan.detail ??
          t`It opens in the importer, which resolves any missing content before saving.`,
      ],
      warnings: plan.warnings,
      confirmLabel: t`Continue`,
      run: () => navigate(plan.route),
    });
  };

  const pickFile = async () => {
    const src = await open({
      title: t`Open a coilbox file`,
      multiple: false,
      filters: [{ name: t`Coilbox file`, extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const { text } = await importContainerFile({ src });
    return text;
  };

  const kindsSentence = containerKindsSentence();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Label htmlFor="import-code" className="text-sm font-semibold">
          <Trans>Code, link or file</Trans>
        </Label>
        <HelpPopover label={t`About importing`}>
          <p>
            <Trans>
              Paste a coilbox link, a share code, the address of a share on the
              web, or the contents of an exported file. Coilbox works out what
              it is and asks before importing anything.
            </Trans>
          </p>
          <p>{t`It takes ${kindsSentence}.`}</p>
        </HelpPopover>
      </div>

      {offer && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 py-2 pr-2 pl-4 text-sm">
          <ClipboardPaste
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="grow">{offer.line}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setSeed(offer.text);
              setFormKey(nextDrawerKey());
              setOffer(null);
            }}
          >
            <Trans>Use it</Trans>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={t`Dismiss the clipboard offer`}
            title={t`Dismiss the clipboard offer`}
            onClick={() => setOffer(null)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      <div className="rounded-md border border-border">
        <ChallengeCodeInput
          key={formKey}
          id="import-code"
          placeholder={t`Paste a coilbox link, a code, or an exported file's contents…`}
          submitLabel={t`Import`}
          busyLabel={t`Checking…`}
          fileButtonLabel={t`Open a file instead…`}
          initialCode={seed}
          onImport={check}
          onPickFile={pickFile}
        />
      </div>

      <ConfirmDialog pending={pending} setPending={setPending} />
    </section>
  );
}

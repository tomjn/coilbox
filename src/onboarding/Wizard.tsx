import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import { DownloadsPill } from "./DownloadsPill";
import { type PageId, WIZARD_TITLE_ID } from "./ids";
import { PAGE_COMPONENTS } from "./pages/registry";
import type { BackgroundProblem } from "./useBackgroundDownloads";
import { WizardArt } from "./WizardArt";

/**
 * The full window setup wizard. It settles a page only on Continue or Skip, and
 * every page in the run on Skip setup. Escape does nothing, so the only way out
 * is a button.
 */
export function Wizard({
  pages,
  onSettle,
  onClose,
  downloads,
  problems,
  onCancelDownload,
  onRetryDownload,
}: {
  pages: PageId[];
  onSettle(id: PageId): void;
  onClose(): void;
  downloads: QueueItem[];
  problems?: BackgroundProblem[];
  onCancelDownload(id: string): void;
  onRetryDownload(id: string): void;
}) {
  const { i18n, t } = useLingui();
  const [step, setStep] = useState(0);
  const id = pages[step];
  const last = step === pages.length - 1;
  const page = PAGE_COMPONENTS[id];
  const { Component } = page;

  const advance = () => {
    onSettle(id);
    if (last) onClose();
    else setStep(step + 1);
  };
  const beforeContinue = useRef<(() => void) | null>(null);
  const continueOn = () => {
    beforeContinue.current?.();
    advance();
  };
  const skipSetup = () => {
    for (const pageId of pages) onSettle(pageId);
    onClose();
  };

  // Focus starts in the wizard, since the app behind it is inert.
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
  }, []);

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={WIZARD_TITLE_ID}
      className="fixed inset-0 z-40 flex flex-col bg-background text-foreground outline-none"
    >
      {/* Everything above the footer, so a page's art runs behind the step
      bar and to every window edge. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {page.art && <WizardArt key={id} art={page.art} />}
        {/* The window's title and traffic lights are native, outside the
        webview, so this top row is the nearest the pill gets to them. */}
        <div className="relative flex justify-end px-4 pt-3">
          <DownloadsPill
            items={downloads}
            problems={problems}
            onCancel={onCancelDownload}
            onRetry={onRetryDownload}
          />
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col px-10 pt-7">
          <div className="mb-6 flex gap-1.5">
            {pages.map((stepId, i) => (
              <span
                key={stepId}
                data-testid="wizard-step"
                className={cn(
                  "h-[3px] flex-1 rounded-full",
                  i <= step ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
          {!page.ownHeading && (
            <h2
              id={WIZARD_TITLE_ID}
              className="mb-5 text-2xl font-semibold tracking-tight"
            >
              {i18n._(page.title)}
            </h2>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <Component
              key={id}
              next={advance}
              skip={advance}
              beforeContinue={beforeContinue}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5 border-t px-10 py-4">
        {!last && (
          <Button variant="ghost" onClick={skipSetup}>
            {t`Skip setup`}
          </Button>
        )}
        <span className="flex-1" />
        {!last && step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)}>
            {t`Back`}
          </Button>
        )}
        {!last && (
          <Button variant="outline" onClick={advance}>
            {t`Skip`}
          </Button>
        )}
        <Button onClick={continueOn}>
          {last ? t`Start playing` : t`Continue`}
        </Button>
      </div>
    </div>
  );
}

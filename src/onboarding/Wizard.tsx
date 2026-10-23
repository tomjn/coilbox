import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import { DownloadsPill } from "./DownloadsPill";
import type { PageId } from "./ids";
import { PAGE_COMPONENTS } from "./pages/registry";

const NEW_PAGES_EYEBROW = msg`New in Coilbox`;

/**
 * The full window setup wizard. It settles a page only on Continue or Skip, and
 * every page in the run on Skip setup. Escape does nothing, so the only way out
 * is a button.
 */
export function Wizard({
  pages,
  newPagesRun,
  onSettle,
  onClose,
  downloads,
  onCancelDownload,
  onRetryDownload,
}: {
  pages: PageId[];
  newPagesRun: boolean;
  onSettle(id: PageId): void;
  onClose(): void;
  downloads: QueueItem[];
  onCancelDownload(id: string): void;
  onRetryDownload(id: string): void;
}) {
  const { i18n, t } = useLingui();
  const [step, setStep] = useState(0);
  const id = pages[step];
  const last = step === pages.length - 1;
  const { Component, eyebrow, title } = PAGE_COMPONENTS[id];

  const advance = () => {
    onSettle(id);
    if (last) onClose();
    else setStep(step + 1);
  };
  const skipSetup = () => {
    for (const page of pages) onSettle(page);
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
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-40 flex flex-col bg-background text-foreground outline-none"
    >
      <DownloadsPill
        items={downloads}
        onCancel={onCancelDownload}
        onRetry={onRetryDownload}
      />
      <div className="flex min-h-0 flex-1 flex-col px-10 pt-10">
        <div className="mb-6 flex gap-1.5">
          {pages.map((page, i) => (
            <span
              key={page}
              data-testid="wizard-step"
              className={cn(
                "h-[3px] flex-1 rounded-full",
                i <= step ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
        <p className="mb-1.5 text-xs text-muted-foreground">
          {i18n._(newPagesRun ? NEW_PAGES_EYEBROW : eyebrow)}
        </p>
        <h2
          id="onboarding-title"
          className="mb-5 text-2xl font-semibold tracking-tight"
        >
          {i18n._(title)}
        </h2>
        <div className="min-h-0 flex-1 overflow-auto">
          <Component key={id} next={advance} skip={advance} />
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
        <Button onClick={advance}>{last ? t`Go to Home` : t`Continue`}</Button>
      </div>
    </div>
  );
}

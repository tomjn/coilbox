import { useLingui } from "@lingui/react/macro";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import { WIZARD_TITLE_ID } from "../ids";
import { useWizardDownloads, useWizardProblems } from "../wizardContexts";
import type { WizardPageProps } from "./registry";

/**
 * A large heading, and the downloads still going in the background, with a
 * line under the heading for any that could not start. The shell paints the
 * picture behind it (`art: "setup"` in the registry). The page draws its own
 * heading, so the shell shows no title.
 */
export default function DonePage(_: WizardPageProps) {
  const { t } = useLingui();
  const downloads = useWizardDownloads();
  // A retry can help the others, so they stay in the pill with its control.
  const unavailable = useWizardProblems().filter((p) => !p.retry);

  return (
    <div className="flex min-h-full items-center py-6">
      <div className="w-full max-w-lg">
        <h2
          id={WIZARD_TITLE_ID}
          className="text-5xl font-semibold tracking-tight"
        >
          {t`You're ready`}
        </h2>
        {unavailable.map((problem) => (
          <p
            key={problem.id}
            data-testid="done-problem"
            className="mt-3 text-muted-foreground"
          >
            {problem.message}
          </p>
        ))}
        {downloads.length > 0 && (
          <div className="mt-8 space-y-3 text-sm">
            {downloads.map((item) => (
              <div key={item.id} data-testid="done-download">
                <p className="mb-1.5 text-muted-foreground">{item.label}</p>
                <QueueProgress item={item} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

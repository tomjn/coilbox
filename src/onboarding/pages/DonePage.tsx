import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import { resolveHome } from "@/home/config";
import { useHomeBackdropStyle } from "@/home/useHomeBackdropStyle";
import { getProfile, resolveProfileImage } from "@/profile/profile";
import { WIZARD_TITLE_ID } from "../ids";
import { useWizardDownloads, useWizardProblems } from "../wizardContexts";
import type { WizardPageProps } from "./registry";

const LAYER = "pointer-events-none absolute inset-0";

/**
 * A large heading over a picture, and the downloads still going in the
 * background, with a line under the heading for any that could not start. The picture is the profile's `setupImage`, or the home page's
 * backdrop when there is none or it fails to load. The page draws its own
 * heading, so the shell shows no title.
 */
export default function DonePage(_: WizardPageProps) {
  const { t } = useLingui();
  const downloads = useWizardDownloads();
  // A retry can help the others, so they stay in the pill with its control.
  const unavailable = useWizardProblems().filter((p) => !p.retry);
  const { setupImage, home } = getProfile();
  // The same backdrop and `home.background` key as the home page, read the way
  // the hub's browse page reads it.
  const backdrop = useHomeBackdropStyle(resolveHome(home).background);
  // undefined while the setup image resolves, so the backdrop never shows first.
  const [image, setImage] = useState<string | null | undefined>(
    typeof setupImage === "string" ? undefined : null,
  );

  useEffect(() => {
    if (typeof setupImage !== "string") return;
    let live = true;
    void resolveProfileImage(setupImage).then((src) => {
      if (live) setImage(src);
    });
    return () => {
      live = false;
    };
  }, [setupImage]);

  return (
    <div className="relative flex min-h-full items-center py-6">
      {setupImage === false || image === undefined ? null : image ? (
        <>
          <img
            src={image}
            alt=""
            data-testid="done-setup-image"
            className={`${LAYER} size-full object-cover`}
            onError={() => setImage(null)}
          />
          {/* Keeps the heading readable over a picture at full strength. */}
          <div
            aria-hidden="true"
            className={`${LAYER} bg-gradient-to-r from-background via-background/70 to-transparent`}
          />
        </>
      ) : (
        backdrop && (
          <div
            aria-hidden="true"
            data-testid="done-backdrop"
            className={LAYER}
            style={backdrop}
          />
        )
      )}
      {/* Positioned, so it paints over the picture without a z-index. */}
      <div className="relative w-full max-w-lg">
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

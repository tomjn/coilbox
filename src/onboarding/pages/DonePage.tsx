import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import CoilMark from "@/general/CoilMark";
import { getProfile, resolveProfileImage } from "@/profile/profile";
import { WIZARD_TITLE_ID } from "../ids";
import { useWizardDownloads } from "../wizardContexts";
import type { WizardPageProps } from "./registry";

const GRAPHIC = "size-48 shrink-0 md:size-64";

/**
 * A large heading beside the profile's setup image or the Coilbox mark, and the
 * downloads still going in the background. The page draws its own heading, so
 * the shell shows no title.
 */
export default function DonePage(_: WizardPageProps) {
  const { t } = useLingui();
  const downloads = useWizardDownloads();
  const wanted = getProfile().setupImage;
  // undefined while the profile's image resolves, so the mark never shows first.
  const [image, setImage] = useState<string | null | undefined>(
    wanted ? undefined : null,
  );

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void resolveProfileImage(wanted).then((src) => {
      if (live) setImage(src);
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-10 py-6 md:flex-row md:justify-between md:gap-16">
      <div className="w-full max-w-lg">
        <h2
          id={WIZARD_TITLE_ID}
          className="text-5xl font-semibold tracking-tight"
        >
          {t`You're ready`}
        </h2>
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
      {image === undefined ? (
        <div data-testid="setup-pending" className={GRAPHIC} />
      ) : image ? (
        <img
          src={image}
          alt=""
          data-testid="setup-image"
          className={`${GRAPHIC} object-contain`}
          onError={() => setImage(null)}
        />
      ) : (
        <div data-testid="setup-mark" className="text-primary">
          <CoilMark className={GRAPHIC} />
        </div>
      )}
    </div>
  );
}

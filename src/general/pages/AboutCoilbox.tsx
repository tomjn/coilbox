import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bug, ExternalLink, Info, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { API_URL, ISSUE_URL, REPO_URL } from "../errorReport";

/** Compact star count: 1234 -> "1.2k", below 1000 shown as-is. */
function formatStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * The "About Coilbox" block on the General settings page: links out to the
 * GitHub repo, the new-issue chooser, and a Star button that shows the live
 * star count. The count is a best-effort anonymous fetch of the public GitHub
 * API on mount; if it fails or is rate-limited (60 req/hr/IP unauthenticated)
 * the button silently falls back to a plain "Star on GitHub". Every link opens
 * in the system browser via the Tauri opener.
 */
export function AboutCoilbox() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(API_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((data) => {
        if (!cancelled && typeof data?.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {
        // Offline / rate-limited: keep the plain Star button, no count.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Info size={15} /> About Coilbox
      </h2>
      <p className="text-xs text-muted-foreground">
        Coilbox is open source. Browse the code, report a bug, or star the
        project on GitHub.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => openUrl(REPO_URL).catch(() => {})}
        >
          <ExternalLink className="size-4" /> Coilbox on GitHub
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => openUrl(ISSUE_URL).catch(() => {})}
        >
          <Bug className="size-4" /> Report an issue
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => openUrl(REPO_URL).catch(() => {})}
        >
          <Star className="size-4" /> Star on GitHub
          {stars !== null && (
            <span className="text-muted-foreground">
              · {formatStars(stars)}
            </span>
          )}
        </Button>
      </div>
    </section>
  );
}

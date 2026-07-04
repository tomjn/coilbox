import { Package } from "lucide-react";
import { getProfile, getProfileSource } from "./profile";

/**
 * Read-only "Distribution profile" settings section. Because a profile silently
 * hides features and presets filters, this is the support-visible surface that
 * makes the reskin diagnosable ("where did the Games tab go?" → it's the profile).
 * Reflects the profile loaded once at startup; nothing here is editable.
 */
export default function ProfileSettings() {
  const profile = getProfile();
  const source = getProfileSource();
  const loaded = source !== "default";

  if (!loaded) {
    return (
      <div className="space-y-8">
        <Header />
        <p className="text-sm text-muted-foreground">
          No distribution profile loaded — standard Coilbox.
        </p>
      </div>
    );
  }

  const hidden = profile.hide ?? [];
  const hiddenSettings = profile.hideSettings ?? [];
  const filter = profile.gameFilter;
  const filterText = filter
    ? [filter.regex, ...(filter.names ?? [])].filter(Boolean).join(", ")
    : null;
  const themeCount = profile.theme ? Object.keys(profile.theme).length : 0;

  return (
    <div className="space-y-8">
      <Header />
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A distribution profile is active (loaded from{" "}
          <span className="font-medium text-foreground">{source}</span>). It
          reskins and narrows this build:
        </p>
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          <Row label="Title" value={profile.title ?? "Coilbox"} />
          <Row label="Colour scheme" value={profile.mode ?? "User choice"} />
          <Row label="Accent" value={profile.accent ?? "User choice"} />
          <Row
            label="Hidden features"
            value={hidden.length ? hidden.join(", ") : "None"}
          />
          <Row
            label="Hidden settings"
            value={hiddenSettings.length ? hiddenSettings.join(", ") : "None"}
          />
          <Row label="Game filter" value={filterText ?? "None"} />
          <Row label="Update repo" value={profile.release?.repo ?? "None"} />
          <Row label="Quit button" value={profile.quit ? "Shown" : "Hidden"} />
          <Row
            label="Welcome screen"
            value={profile.welcome ? "Custom" : "Default"}
          />
          <Row
            label="Theme overrides"
            value={themeCount ? `${themeCount} variable(s)` : "None"}
          />
        </dl>
      </section>
    </div>
  );
}

function Header() {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      <Package size={15} /> Distribution profile
    </h2>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

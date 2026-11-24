/**
 * How each sign-in provider the hub might list looks: its name, its brand
 * colour and its mark. The same colours and marks as the hub's own sign-in
 * buttons (`hub-php/resources/views/components/ui/sign-in-buttons.blade.php`
 * in tomjn/coilbox-hub), so the two look alike. A provider not here gets a
 * plain button under the id the hub sent.
 */

interface ProviderLook {
  /** A brand name, so not translated. */
  name: string;
  /** Background classes. White text on each passes AA, except Google's,
   * which sets its own dark text. */
  colours: string;
  /** The mark from simple-icons (CC0), on a 24 by 24 grid, drawn in the text
   * colour. Or a mark that keeps its own colours, on its own grid. */
  path: string | { viewBox: string; paths: { d: string; fill: string }[] };
}

const LOOKS: Record<string, ProviderLook> = {
  discord: {
    name: "Discord",
    colours: "bg-[#5865F2] hover:bg-[#4752c4] active:bg-[#3b45a3]",
    path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
  github: {
    name: "GitHub",
    colours:
      "border border-neutral-600 bg-[#24292f] hover:bg-[#32383f] active:bg-[#1b1f24]",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  google: {
    name: "Google",
    // Google's branding rules ask for its mark on white with dark text.
    colours:
      "text-[#1f1f1f] border border-[#747775] bg-white hover:bg-[#f2f2f2] active:bg-[#e8e8e8]",
    path: {
      viewBox: "0 0 48 48",
      paths: [
        {
          fill: "#EA4335",
          d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z",
        },
        {
          fill: "#4285F4",
          d: "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z",
        },
        {
          fill: "#FBBC05",
          d: "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z",
        },
        {
          fill: "#34A853",
          d: "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z",
        },
      ],
    },
  },
  twitch: {
    name: "Twitch",
    colours: "bg-[#9146FF] hover:bg-[#772ce8] active:bg-[#5c16c5]",
    path: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
  },
};

export function providerName(id: string): string {
  return LOOKS[id]?.name ?? id;
}

/** The brand background for a provider's button, or null for one not known. */
export function providerColours(id: string): string | null {
  return LOOKS[id]?.colours ?? null;
}

/** A provider's mark beside its name, so it is hidden from screen readers.
 * Nothing for a provider not known. */
export function ProviderLogo({
  provider,
  className = "size-4",
}: {
  provider: string;
  className?: string;
}) {
  const look = LOOKS[provider];
  if (!look) return null;
  if (typeof look.path !== "string") {
    return (
      <svg viewBox={look.path.viewBox} aria-hidden="true" className={className}>
        {look.path.paths.map(({ d, fill }) => (
          <path key={fill} d={d} fill={fill} />
        ))}
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d={look.path} />
    </svg>
  );
}

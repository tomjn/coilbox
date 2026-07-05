import BrandedWelcome from "../../profile/BrandedWelcome";
import { GetStartedCard } from "./components/GetStartedCard";
import { SetupCard } from "./components/SetupCard";

/**
 * The branded `/` override: the first-run setup card above the profile's branded
 * welcome. Installed as the home only when `profile.welcome` is present (see
 * main.tsx); vanilla Coilbox uses picoframe's built-in launcher instead, which
 * shows the setup card via the content plugin's `home.top` slot.
 */
export default function SetupHome() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <SetupCard dismissible />
      <GetStartedCard />
      <BrandedWelcome />
    </div>
  );
}

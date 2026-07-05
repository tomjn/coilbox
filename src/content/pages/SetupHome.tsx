import BrandedWelcome from "../../profile/BrandedWelcome";
import { getProfile } from "../../profile/profile";
import { SetupCard } from "./components/SetupCard";

/** The `/` page: a first-run setup card above the (branded or default) welcome. */
export default function SetupHome() {
  const hasWelcome = !!getProfile().welcome;
  return (
    <div className="flex flex-col gap-4 p-4">
      <SetupCard dismissible />
      {hasWelcome ? (
        <BrandedWelcome />
      ) : (
        <div className="text-sm text-muted-foreground">
          Welcome to Coilbox. Use the sidebar to browse content, host or join
          battles, and manage engines.
        </div>
      )}
    </div>
  );
}

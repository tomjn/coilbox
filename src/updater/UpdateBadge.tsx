import { Download } from "lucide-react";
import { Link } from "react-router";
import { useUpdater } from "./UpdaterProvider";

/** topbar.right slot: an "Update available" pill, shown only when an update exists. */
export default function UpdateBadge() {
  const { update } = useUpdater();
  if (!update) return null;
  return (
    <Link
      to="/settings/updates"
      className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
    >
      <Download size={14} />
      Update available
    </Link>
  );
}

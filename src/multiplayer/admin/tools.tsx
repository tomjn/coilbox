import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  Activity,
  Ban,
  Bot,
  Hash,
  type LucideIcon,
  Mail,
  Megaphone,
  Server,
  Shield,
  Users,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";
import { AnnouncementsSection } from "./AnnouncementsSection";
import { BansSection } from "./BansSection";
import { BotAccountsSection } from "./BotAccountsSection";
import { ChannelsSection } from "./ChannelsSection";
import { EmailDomainsSection } from "./EmailDomainsSection";
import { MaintenanceSection } from "./MaintenanceSection";
import { ModeratorFeedSection } from "./ModeratorFeedSection";
import { PlayerLookupSection } from "./PlayerLookupSection";
import { ServerAddressSection } from "./ServerAddressSection";
import { StaffSection } from "./StaffSection";
import type { AdminToolEntry } from "./toolNav";

/**
 * One tool on the Server admin page (issue #2918): an entry in the page's
 * left-hand nav, and the component shown when it is chosen.
 *
 * To add a tool, write a component that takes `{ serverKey }` and draws its
 * own `<ToolHeader>`, then add an entry here. `id` is what `?tool=` carries,
 * so keep it stable once shipped. Set `adminOnly` for a tool whose commands
 * uberserver keeps for admins (`restricted['admin']` in
 * `protocol/Protocol.py`). The nav then lists it under "Admin only", and a
 * moderator never sees it.
 */
export interface AdminTool extends AdminToolEntry {
  id: string;
  label: MessageDescriptor;
  icon: LucideIcon;
  Component: ComponentType<{ serverKey: string }>;
}

/** Every tool, in nav order. Moderation tools first, then admin-only ones. */
export const ADMIN_TOOLS: AdminTool[] = [
  {
    id: "players",
    label: msg`Players`,
    icon: Users,
    Component: PlayerLookupSection,
  },
  { id: "bans", label: msg`Bans`, icon: Ban, Component: BansSection },
  {
    id: "emailDomains",
    label: msg`Email domains`,
    icon: Mail,
    Component: EmailDomainsSection,
  },
  {
    id: "channels",
    label: msg`Channels`,
    icon: Hash,
    Component: ChannelsSection,
  },
  { id: "bots", label: msg`Bots`, icon: Bot, Component: BotAccountsSection },
  {
    id: "activity",
    label: msg`Staff activity`,
    icon: Activity,
    Component: ModeratorFeedSection,
  },
  {
    id: "server",
    label: msg`Server`,
    icon: Server,
    Component: ServerAddressSection,
  },
  {
    id: "maintenance",
    label: msg`Maintenance`,
    icon: Wrench,
    adminOnly: true,
    Component: MaintenanceSection,
  },
  {
    id: "staff",
    label: msg`Staff`,
    icon: Shield,
    adminOnly: true,
    Component: StaffSection,
  },
  {
    id: "announcements",
    label: msg`Announcements`,
    icon: Megaphone,
    adminOnly: true,
    Component: AnnouncementsSection,
  },
];

import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { updateStoredSetting } from "@/lib/storedSetting";
import { AddAccountForm } from "@/lobby-servers/AddAccountForm";
import {
  type AccountsConfig,
  allServers,
  defaultAccounts,
  LOBBY_ACCOUNTS_KEY,
  type LobbyAccount,
  useCustomServers,
  useLobbyAccounts,
} from "@/lobby-servers/config";
import { RegisterForm } from "@/lobby-servers/RegisterForm";
import { PageArt } from "./PageArt";
import type { WizardPageProps } from "./registry";

/**
 * The lobby settings' add login and register forms, side by side as tabs, in
 * a column on the left over the lobby login drawing from Home.
 * `allServers` already lists the profile's official server first. A
 * registration that finishes after the player has moved on does not move the
 * wizard a second time.
 */
export default function ServerPage({ next, skip }: WizardPageProps) {
  const [accountsCfg, setAccountsCfg] = useLobbyAccounts();
  const [customCfg] = useCustomServers();
  const servers = allServers(customCfg.servers);
  const [draft] = useState<LobbyAccount>(() => ({
    id: crypto.randomUUID(),
    serverId: servers[0]?.id ?? "",
    username: "",
    hasSecret: false,
  }));
  const shown = useRef(true);

  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  // The same write the lobby settings make, folded over what is stored.
  const addAccount = (a: LobbyAccount) => {
    updateStoredSetting<AccountsConfig>(
      LOBBY_ACCOUNTS_KEY,
      defaultAccounts,
      setAccountsCfg,
      (prev) => ({ ...prev, accounts: [...prev.accounts, a] }),
    );
    next();
  };

  const registered = () => {
    if (shown.current) next();
  };

  return (
    <div className="relative min-h-full">
      <PageArt toolId="multiplayer.lobby" />
      {/* Positioned, so it paints over the drawing without a z-index. */}
      <Tabs defaultValue="login" className="relative max-w-md">
        <TabsList>
          <TabsTrigger value="login">
            <Trans>Log in</Trans>
          </TabsTrigger>
          <TabsTrigger value="register">
            <Trans>Register</Trans>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="login" className="flex flex-col">
          <AddAccountForm
            draft={draft}
            accounts={accountsCfg.accounts}
            servers={servers}
            onAdd={addAccount}
            onCancel={skip}
          />
        </TabsContent>
        <TabsContent value="register">
          <RegisterForm
            servers={servers}
            onSuccess={registered}
            onCancel={skip}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

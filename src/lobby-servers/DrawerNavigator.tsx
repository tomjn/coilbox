import { useEffect } from "react";
import { useNavigate } from "react-router";
import { registerDrawerNavigator } from "./drawerRequest";

/**
 * Hands the router's `navigate` to {@link registerDrawerNavigator}, so a
 * notification button can open a drawer on the lobby servers page. Draws nothing.
 */
export function DrawerNavigator() {
  const navigate = useNavigate();
  useEffect(() => registerDrawerNavigator((to) => navigate(to)), [navigate]);
  return null;
}

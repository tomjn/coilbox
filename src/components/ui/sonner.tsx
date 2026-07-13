import { useTheme } from "@picoframe/frame";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toast host. Mounted once by the notify plugin's Provider. Themed from
 * picoframe's resolved appearance so toasts follow the app's light/dark mode.
 */
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      richColors
      style={
        {
          // Use the resolved `hsl(...)` colour tokens, not the bare
          // `--popover` HSL components: sonner needs a valid CSS colour here, and
          // `var(--popover)` alone ("0 0% 100%") paints as nothing - a
          // transparent toast (default/typeless toasts don't get richColors).
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };

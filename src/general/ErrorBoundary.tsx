import { Button } from "@picoframe/frame";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, Bug, Check, ChevronRight, Copy } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatErrorReport, newIssueUrl } from "./errorReport";

interface Props {
  children: ReactNode;
  /**
   * What to show instead of the whole-page report, for a boundary put round one
   * part of a page rather than round the app.
   *
   * The report below takes the window, which is right when the thing that threw
   * is the screen and wrong when it is a panel on one: a 3D scene that cannot
   * draw should not take the triggers, the objectives and the setup down with
   * it. A caller passing this keeps the rest of its page and says what is
   * missing in the space the broken part was in.
   */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
  route: string;
  version: string;
  copied: boolean;
}

/**
 * App-wide safety net. A render-time throw anywhere below `<AppFrame>` would
 * otherwise white-screen the whole shell with no message and no recovery; this
 * catches it and offers a Reload instead. Styled to match the destructive
 * banners in `content/pages/components/states.tsx` so it reads as "part of the
 * app", not a raw crash.
 *
 * It intentionally does NOT reset on prop change: once a page has thrown, the
 * safe action is a full reload, not silently re-rendering the same broken tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  private copyReset: ReturnType<typeof setTimeout> | undefined;

  state: State = {
    error: null,
    componentStack: "",
    route: "",
    version: "",
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("coilbox: render error caught by boundary", error, info);
    // The boundary lives outside AppFrame's HashRouter, so router hooks are
    // unreachable — read the route straight off the hash captured at crash time.
    this.setState({
      componentStack: info.componentStack ?? "",
      route: window.location.hash,
    });
    // App version is injected only at release build (dev reads 0.0.0); best-effort.
    getVersion()
      .then((version) => this.setState({ version }))
      .catch(() => {});
  }

  componentWillUnmount() {
    clearTimeout(this.copyReset);
  }

  private report(): string {
    const { error, route, componentStack, version } = this.state;
    return formatErrorReport({
      message: error?.message ?? "Unknown error",
      route,
      jsStack: error?.stack,
      componentStack,
      version,
    });
  }

  private copy = () => {
    navigator.clipboard
      .writeText(this.report())
      .then(() => {
        this.setState({ copied: true });
        clearTimeout(this.copyReset);
        this.copyReset = setTimeout(
          () => this.setState({ copied: false }),
          1500,
        );
      })
      .catch(() => {});
  };

  render() {
    const { error, route, copied } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <main className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-10 text-center">
        <Alert variant="destructive" className="max-w-lg text-left">
          <AlertCircle />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription className="grid min-w-0 gap-3">
            <p>
              The screen you were on hit an unexpected error. Reloading usually
              clears it. If this keeps happening, copy the details below and
              report it so it can be fixed.
            </p>
            <Collapsible
              defaultOpen
              className="min-w-0 rounded-md border border-border/50 bg-card p-2"
            >
              <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 text-left text-xs text-muted-foreground">
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                Error details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                  {route || "(unknown route)"}
                </p>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                  {error.message}
                  {error.stack ? `\n\n${error.stack}` : ""}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => location.reload()}>Reload</Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => openUrl(newIssueUrl(this.report())).catch(() => {})}
          >
            <Bug className="size-4" /> Report an issue
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={this.copy}>
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
      </main>
    );
  }
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Mark } from "@/components/Mark";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Health } from "@/types";

const HealthContext = createContext<Health | null>(null);

export function useHealth() {
  return useContext(HealthContext);
}

export function Shell() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((next) => {
        if (!cancelled) {
          setHealth(next);
          setOffline(false);
        }
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const banner = offline
    ? "The PayGuard API is not responding. Start it with npm run dev and reload this page."
    : health
      ? modeBanner(health)
      : null;

  return (
    <HealthContext.Provider value={health}>
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <NavLink to="/" end className="flex items-center gap-2 text-foreground">
              <Mark className="size-8 text-primary" />
              <span className="font-serif text-xl tracking-tight">PayGuard</span>
            </NavLink>
            <nav className="flex items-center gap-1" aria-label="Primary">
              <TopLink to="/" end>
                New hold
              </TopLink>
              <TopLink to="/deals">Deals</TopLink>
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {health ? (
                <>
                  <Pill>PayPal · {health.paypal === "sandbox" ? "Sandbox" : "Mock"}</Pill>
                  <Pill>AI · {health.ai === "live" ? (health.model ?? "Live") : "Built-in"}</Pill>
                </>
              ) : null}
            </div>
          </div>
          {banner ? (
            <div className="border-t bg-accent/70">
              <p className="mx-auto max-w-6xl px-4 py-2 text-xs leading-5 text-accent-foreground">{banner}</p>
            </div>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-xs leading-5 text-muted-foreground">
          PayGuard is a hackathon prototype. A PayPal authorization is a hold on the buyer’s funds, not a
          licensed escrow account. Sandbox money is not real. PayPal honors an authorization for 3 days and
          allows capture for up to 29 days.
        </footer>
      </div>
    </HealthContext.Provider>
  );
}

function TopLink({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "rounded-full px-3 py-1.5 text-sm",
          isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
    >
      {children}
    </NavLink>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">{children}</span>;
}

function modeBanner(health: Health): string | null {
  if (health.paypal === "mock" && health.ai === "mock") {
    return "Demo mode. New holds and the language reader run on this machine, so you can click through a full authorization without API keys.";
  }
  if (health.paypal === "mock") {
    return "PayPal is simulated. The language reader is using your configured model.";
  }
  if (health.ai === "mock") {
    return "The language reader is the built-in parser. New holds are created in the PayPal Sandbox.";
  }
  return null;
}

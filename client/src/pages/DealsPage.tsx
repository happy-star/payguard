import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert } from "@/components/Alert";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatMoney, messageFrom, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTitle } from "@/lib/useTitle";
import type { Deal, DealStatus } from "@/types";

type Filter = "all" | "open" | "held" | "released" | "closed";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Awaiting approval" },
  { id: "held", label: "On hold" },
  { id: "released", label: "Released" },
  { id: "closed", label: "Closed" },
];

export function DealsPage() {
  useTitle("Deals");
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [seeding, setSeeding] = useState(false);

  async function load() {
    setError(null);
    try {
      const result = await api.deals();
      setDeals(result.deals);
    } catch (err) {
      setError(messageFrom(err));
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .deals()
      .then((result) => {
        if (!cancelled) setDeals(result.deals);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageFrom(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function seed() {
    setSeeding(true);
    setError(null);
    try {
      await api.seed();
      await load();
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setSeeding(false);
    }
  }

  const visible = (deals ?? []).filter((deal) => matches(deal.status, filter));
  const counts = {
    open: (deals ?? []).filter((deal) => matches(deal.status, "open")).length,
    held: (deals ?? []).filter((deal) => matches(deal.status, "held")).length,
    released: (deals ?? []).filter((deal) => matches(deal.status, "released")).length,
  };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Ledger</p>
          <h1 className="font-serif text-4xl tracking-tight">Deals</h1>
        </div>
        <Button asChild className="h-10">
          <Link to="/">New hold</Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Awaiting approval" value={deals ? String(counts.open) : "—"} />
        <Stat label="On hold" value={deals ? String(counts.held) : "—"} />
        <Stat label="Released" value={deals ? String(counts.released) : "—"} />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter deals">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              filter === item.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {deals === null && !error ? (
        <div className="grid gap-3" aria-hidden>
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : null}

      {deals && deals.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 py-8">
            <h2 className="font-serif text-2xl">No holds yet</h2>
            <p className="max-w-lg text-sm leading-6 text-muted-foreground">
              Describe a gig to open the first authorization, or load three sample deals so the ledger has
              something to show. Samples stay in mock mode even if Sandbox keys are configured.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/">Describe a gig</Link>
              </Button>
              <Button type="button" variant="outline" disabled={seeding} onClick={() => void seed()}>
                {seeding ? "Loading samples…" : "Load sample deals"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {deals && deals.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this filter.</p>
      ) : null}

      <ul className="grid gap-3">
        {visible.map((deal) => (
          <li key={deal.id}>
            <Link
              to={`/deals/${deal.id}`}
              className="grid gap-3 rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10 transition-colors hover:bg-accent/40 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{deal.title}</h2>
                  <StatusBadge status={deal.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {deal.freelancerName} for {deal.buyerName}
                  {deal.paypal.mode === "sandbox" ? " · Sandbox" : " · Mock"}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="font-serif text-2xl tabular-nums">{formatMoney(deal.amount, deal.currency)}</p>
                <p className="text-xs text-muted-foreground">{timeAgo(deal.updatedAt)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {deals && deals.length > 0 ? (
        <div>
          <Button type="button" variant="outline" disabled={seeding} onClick={() => void seed()}>
            {seeding ? "Refreshing samples…" : "Reset sample deals"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-serif text-3xl tabular-nums">{value}</p>
    </div>
  );
}

function matches(status: DealStatus, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return status === "created" || status === "approved";
  if (filter === "held") return status === "authorized";
  if (filter === "released") return status === "captured";
  return status === "voided" || status === "cancelled" || status === "failed";
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { formatMoney, messageFrom } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import type { Deal } from "@/types";

export function CheckoutPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<"approve" | "cancel" | null>(null);
  useTitle("Mock approval");

  useEffect(() => {
    let cancelled = false;
    api
      .deal(id)
      .then((next) => {
        if (!cancelled) setDeal(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(messageFrom(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function approve() {
    setPending("approve");
    setError(null);
    try {
      const next = await api.approve(id);
      navigate(`/deals/${next.id}?returned=1`);
    } catch (err) {
      setError(messageFrom(err));
      setPending(null);
    }
  }

  async function cancel() {
    setPending("cancel");
    setError(null);
    try {
      const next = await api.cancel(id);
      navigate(`/deals/${next.id}?cancelled=1`);
    } catch (err) {
      setError(messageFrom(err));
      setPending(null);
    }
  }

  if (missing) {
    return <p className="text-sm">This approval link does not match a PayGuard deal.</p>;
  }

  if (!deal && !error) {
    return <div className="mx-auto h-64 max-w-md animate-pulse rounded-2xl bg-muted" aria-busy="true" />;
  }

  if (!deal) return <Alert>{error}</Alert>;

  const actionable = deal.paypal.mode === "mock" && (deal.status === "created" || deal.status === "approved");

  return (
    <div className="mx-auto grid max-w-md gap-4">
      <Card className="overflow-hidden">
        <div className="bg-primary px-5 py-4 text-primary-foreground">
          <p className="text-xs tracking-[0.14em] uppercase">PayGuard mock approval</p>
          <p className="mt-1 font-serif text-2xl">Approve a hold, not a payment</p>
        </div>
        <CardContent className="grid gap-4 pt-5">
          <p className="text-sm leading-6 text-muted-foreground">
            This screen stands in for the PayPal Sandbox approval page. It does not move real or Sandbox money.
            Approving reserves {formatMoney(deal.amount, deal.currency)} until the milestone is captured or voided.
          </p>
          <div>
            <p className="font-serif text-4xl tabular-nums">{formatMoney(deal.amount, deal.currency)}</p>
            <p className="mt-1 text-sm">{deal.title}</p>
            <p className="text-sm text-muted-foreground">
              {deal.buyerName} approves a hold for {deal.freelancerName}.
            </p>
          </div>
          <ul className="grid gap-1 text-sm">
            {deal.milestones.map((milestone) => (
              <li key={milestone.id} className="rounded-lg bg-muted px-3 py-2">
                {milestone.condition}
              </li>
            ))}
          </ul>
          {deal.paypal.mode === "sandbox" ? (
            <Alert tone="note">
              This deal uses PayPal Sandbox. Approve it on PayPal, not on this stand-in page.
            </Alert>
          ) : null}
          {!actionable && deal.paypal.mode === "mock" ? (
            <Alert tone="note">This deal is already {deal.status}. There is nothing left to approve here.</Alert>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          {actionable ? (
            <div className="grid gap-2">
              <Button type="button" className="h-11" data-testid="approve-hold" disabled={pending !== null} onClick={() => void approve()}>
                {pending === "approve" ? "Approving…" : "Approve the hold"}
              </Button>
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void cancel()}>
                {pending === "cancel" ? "Cancelling…" : "Cancel"}
              </Button>
            </div>
          ) : (
            <Button asChild variant="outline">
              <Link to={`/deals/${deal.id}`}>Back to the deal</Link>
            </Button>
          )}
          {deal.paypal.mode === "sandbox" && deal.paypal.approveUrl ? (
            <Button asChild>
              <a href={deal.paypal.approveUrl}>Continue to PayPal Sandbox</a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

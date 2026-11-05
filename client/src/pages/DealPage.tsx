import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert } from "@/components/Alert";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api";
import { formatMoney, formatWhen, messageFrom, statusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTitle } from "@/lib/useTitle";
import type { Deal, DealStatus } from "@/types";

export function DealPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "capture" | "void">(null);
  const [copied, setCopied] = useState(false);
  useTitle(deal?.title ?? "Deal");

  useEffect(() => {
    let cancelled = false;
    setDeal(null);
    setMissing(false);
    setError(null);
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

  async function run(action: string, task: () => Promise<Deal>) {
    setPending(action);
    setError(null);
    try {
      setDeal(await task());
      setConfirm(null);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setPending(null);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (missing) {
    return (
      <div className="grid max-w-lg gap-3">
        <h1 className="font-serif text-4xl">No deal with that id.</h1>
        <Button asChild className="w-fit">
          <Link to="/deals">Back to deals</Link>
        </Button>
      </div>
    );
  }

  if (!deal && !error) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="grid max-w-lg gap-3">
        <Alert>{error}</Alert>
        <Button type="button" variant="outline" className="w-fit" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const notice = params.get("error");
  const returned = params.get("returned") === "1";
  const cancelled = params.get("cancelled") === "1";
  const openMilestones = deal.milestones.filter((milestone) => !milestone.done);
  const locked = deal.status === "captured" || deal.status === "voided" || deal.status === "cancelled";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="order-2 grid gap-5 lg:order-1">
        <header className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={deal.status} />
            <span className="text-xs text-muted-foreground">
              {deal.paypal.mode === "sandbox" ? "PayPal Sandbox" : "Mock PayPal"}
            </span>
          </div>
          <h1 className="font-serif text-4xl tracking-tight text-balance">{deal.title}</h1>
          <p className="text-sm text-muted-foreground">
            {deal.freelancerName} for {deal.buyerName}
            {deal.dueDate ? ` · due ${deal.dueDate}` : ""}
          </p>
          <p className="font-serif text-5xl tabular-nums">{formatMoney(deal.amount, deal.currency)}</p>
        </header>

        {notice ? <Alert>{notice}</Alert> : null}
        {returned ? <Alert tone="ok">The buyer came back from approval. The hold status is below.</Alert> : null}
        {cancelled ? <Alert tone="note">The buyer left the approval screen.</Alert> : null}
        {(notice || returned || cancelled) && (
          <button
            type="button"
            className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setParams({}, { replace: true })}
          >
            Dismiss
          </button>
        )}

        {deal.status !== "failed" ? <Stepper status={deal.status} /> : null}
        {error ? <Alert>{error}</Alert> : null}
        {deal.paypal.lastError && deal.status !== "captured" ? <Alert>{deal.paypal.lastError}</Alert> : null}

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Guard note</CardTitle>
            <p className="text-xs text-muted-foreground">Plain language for this status.</p>
            <CardAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => void run("explain", () => api.explain(deal.id))}
              >
                {pending === "explain" ? "Rewriting…" : "Rewrite"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7">{deal.explanation}</p>
          </CardContent>
        </Card>

        <section className="grid gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-2xl">Milestones</h2>
            <p className="text-xs text-muted-foreground">
              {deal.milestones.filter((milestone) => milestone.done).length} of {deal.milestones.length} checked
            </p>
          </div>
          <ul className="grid gap-2">
            {deal.milestones.map((milestone) => (
              <li key={milestone.id} className="flex gap-3 rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10">
                <Checkbox
                  checked={milestone.done}
                  disabled={locked || pending !== null}
                  aria-label={milestone.title}
                  onCheckedChange={(value) =>
                    void run(`ms-${milestone.id}`, () => api.milestone(deal.id, milestone.id, value === true))
                  }
                />
                <div>
                  <p className="text-sm font-medium">{milestone.title}</p>
                  <p className="text-sm text-muted-foreground">{milestone.condition}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-3">
          <h2 className="font-serif text-2xl">Activity</h2>
          <ol>
            {deal.events.map((event, index) => (
              <li key={`${event.at}-${index}`} className="grid grid-cols-[16px_1fr] gap-3">
                <span className="flex flex-col items-center">
                  <span className="mt-1.5 size-2 rounded-full bg-primary" />
                  {index < deal.events.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </span>
                <div className="pb-4">
                  <p className="text-sm leading-6">{event.note}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatWhen(event.at)} · {statusLabel(event.status)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="order-1 grid gap-4 lg:sticky lg:top-24 lg:order-2">
        <Card>
          <CardHeader>
            <CardTitle>{actionTitle(deal.status)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm leading-6 text-muted-foreground">{actionBody(deal)}</p>
            {deal.status === "created" && deal.paypal.approveUrl ? (
              <Button asChild className="h-11">
                <a href={deal.paypal.approveUrl}>
                  {deal.paypal.mode === "sandbox" ? "Approve on PayPal Sandbox" : "Open mock approval"}
                </a>
              </Button>
            ) : null}
            {deal.status === "approved" ? (
              <Button
                type="button"
                className="h-11"
                disabled={pending !== null}
                onClick={() => void run("authorize", () => api.authorize(deal.id))}
              >
                {pending === "authorize" ? "Placing the hold…" : "Place the hold"}
              </Button>
            ) : null}
            {deal.status === "authorized" ? (
              <>
                <Button type="button" className="h-11" data-testid="release-funds" onClick={() => setConfirm("capture")}>
                  Release funds
                </Button>
                <Button type="button" variant="outline" onClick={() => setConfirm("void")}>
                  Void the hold
                </Button>
              </>
            ) : null}
            {deal.status === "failed" ? (
              <Button
                type="button"
                className="h-11"
                disabled={pending !== null}
                onClick={() => void run("retry", () => api.retryOrder(deal.id))}
              >
                {pending === "retry" ? "Trying again…" : "Try the hold again"}
              </Button>
            ) : null}
            {(deal.status === "created" || deal.status === "approved") && (
              <Button
                type="button"
                variant="outline"
                disabled={pending !== null}
                onClick={() => void run("cancel", () => api.cancel(deal.id))}
              >
                Buyer walked away
              </Button>
            )}
            {(deal.status === "captured" || deal.status === "voided" || deal.status === "cancelled") && (
              <Button asChild variant="outline">
                <Link to="/">Start another hold</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>PayPal ids</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs">
            <IdRow label="Order" value={deal.paypal.orderId} />
            <IdRow label="Order status" value={deal.paypal.orderStatus} />
            <IdRow label="Authorization" value={deal.paypal.authorizationId} />
            <IdRow label="Capture" value={deal.paypal.captureId} />
            <IdRow label="Payer" value={deal.paypal.payerId} />
            {deal.paypal.approveUrl ? (
              <div className="grid gap-1 pt-1">
                <p className="text-muted-foreground">Approval link</p>
                <input
                  readOnly
                  value={deal.paypal.approveUrl}
                  className="h-8 rounded-md border bg-background px-2 text-[11px]"
                  aria-label="Approval link"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => void copyLink(deal.paypal.approveUrl ?? "")}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </aside>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === "void" ? "Void this hold?" : "Release the hold?"}</DialogTitle>
            <DialogDescription>
              {confirm === "void"
                ? `${formatMoney(deal.amount, deal.currency)} goes back to ${deal.buyerName}. Nothing is captured.`
                : openMilestones.length > 0
                  ? `${openMilestones.length} condition${openMilestones.length === 1 ? " is" : "s are"} still unchecked: ${openMilestones.map((milestone) => milestone.title).join(", ")}. Capturing anyway settles the full ${formatMoney(deal.amount, deal.currency)}.`
                  : `This captures ${formatMoney(deal.amount, deal.currency)} to the merchant on these PayPal credentials.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Keep holding
            </Button>
            {confirm === "void" ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending !== null}
                onClick={() => void run("void", () => api.voidHold(deal.id))}
              >
                {pending === "void" ? "Voiding…" : "Void hold"}
              </Button>
            ) : (
              <Button
                type="button"
                data-testid="confirm-release"
                disabled={pending !== null}
                onClick={() => void run("capture", () => api.capture(deal.id))}
              >
                {pending === "capture" ? "Releasing…" : "Release funds"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stepper({ status }: { status: DealStatus }) {
  const labels = [
    status === "cancelled" ? "Cancelled" : "Order created",
    "Buyer approved",
    status === "voided" ? "Hold voided" : "Funds held",
    "Released",
  ];
  const current = stepIndex(status);
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Hold progress">
      {labels.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="grid gap-2">
            <span
              className={cn(
                "h-1.5 rounded-full",
                state === "upcoming" && "bg-border",
                state === "done" && "bg-primary",
                state === "current" && "bg-primary",
              )}
            />
            <span className={cn("text-xs", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function stepIndex(status: DealStatus): number {
  switch (status) {
    case "failed":
    case "created":
    case "cancelled":
      return 0;
    case "approved":
      return 1;
    case "authorized":
    case "voided":
      return 2;
    case "captured":
      return 3;
  }
}

function actionTitle(status: DealStatus): string {
  switch (status) {
    case "created":
      return "Waiting for the buyer";
    case "approved":
      return "Finish the hold";
    case "authorized":
      return "Funds are reserved";
    case "captured":
      return "Released";
    case "voided":
      return "Hold voided";
    case "cancelled":
      return "Approval cancelled";
    case "failed":
      return "The order was not created";
  }
}

function actionBody(deal: Deal): string {
  if (deal.status === "created" && deal.paypal.mode === "mock") {
    return "Nothing is reserved yet. The mock approval page stands in for the PayPal Sandbox screen.";
  }
  if (deal.status === "created") {
    return "Nothing is reserved yet. PayPal may label the button Pay. This order’s intent is AUTHORIZE, so approval holds the funds instead of capturing them.";
  }
  if (deal.status === "authorized") {
    return "Capture when the milestone is accepted. Void if the job stops. The honor period is 3 days; capture stays available for up to 29.";
  }
  if (deal.status === "failed") return "No money moved. You can retry the same terms.";
  if (deal.status === "captured") return "The authorization was captured. This deal is settled.";
  if (deal.status === "voided") return "The authorization was voided. The buyer was not charged.";
  if (deal.status === "cancelled") return "The buyer did not approve. Start a new hold if the job is still on.";
  return "The buyer approved, and the authorization still needs to be placed.";
}

function IdRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[11px]">{value ?? "—"}</span>
    </div>
  );
}

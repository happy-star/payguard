import { formatMoney } from "../money";
import type { Deal, DealStatus } from "../types";

export function explainDeal(deal: Deal): string {
  const money = formatMoney(deal.amount, deal.currency);
  const parties = `${deal.buyerName} is the buyer and ${deal.freelancerName} is the freelancer.`;
  const milestones = deal.milestones.map((milestone) => milestone.title).join("; ");
  const milestoneLine = milestones ? ` Milestones on this hold: ${milestones}.` : "";

  switch (deal.status) {
    case "created":
      return deal.paypal.mode === "mock"
        ? `A practice order${deal.paypal.orderId ? ` (${deal.paypal.orderId})` : ""} is waiting for ${deal.buyerName}. Nothing is reserved yet. Open the mock approval page to simulate their OK on a ${money} authorization. After that, PayGuard places the hold. With Sandbox keys, this step is the real PayPal approval screen instead. ${parties}${milestoneLine}`
        : `PayPal Sandbox order ${deal.paypal.orderId ?? ""} is waiting for ${deal.buyerName}. Nothing is reserved yet. They approve it with a Sandbox personal account, PayPal sends them back here, and PayGuard then authorizes ${money}. The PayPal button may say Pay. This order's intent is AUTHORIZE, so the money is held rather than captured.${milestoneLine} ${parties}`;
    case "approved":
      return `${deal.buyerName} approved the order, but the authorization is not finished. Retry the hold to reserve ${money}. ${parties}${milestoneLine}`;
    case "authorized":
      return `${money} is on hold${deal.paypal.authorizationId ? ` (authorization ${deal.paypal.authorizationId})` : ""}. ${parties} PayPal honors an authorization for 3 days and still allows capture for up to 29 days. Release the funds when the milestone is accepted, or void the hold to return the money. Nothing has been captured yet.${milestoneLine}`;
    case "captured":
      return `${money} was captured${deal.paypal.captureId ? ` (${deal.paypal.captureId})` : ""}. The hold settled to the PayPal merchant on this app's credentials. In the demo, that Sandbox business account stands in for the freelancer getting paid. ${parties}`;
    case "voided":
      return `The authorization was voided. ${money} is no longer held, and the buyer was not charged. ${parties}`;
    case "cancelled":
      return `${deal.buyerName} left before approving. ${money} was not reserved. Create a new hold if the job is still on.`;
    case "failed":
      return `PayPal did not create the order. ${deal.paypal.lastError ?? "No reason came back."} No money moved. Adjust the terms and try again.`;
    default: {
      const neverStatus: never = deal.status;
      return neverStatus;
    }
  }
}

export function nextStep(deal: Deal): string {
  switch (deal.status) {
    case "created":
      return "Send the buyer to approve the hold.";
    case "approved":
      return "Retry authorization so the funds are actually reserved.";
    case "authorized":
      return deal.milestones.every((milestone) => milestone.done)
        ? "The conditions are checked off. Capture the authorization to pay the freelancer."
        : "Check off each milestone as it is met, then capture the authorization.";
    case "captured":
      return "This deal is settled. Nothing further happens in PayPal.";
    case "voided":
      return "The hold is closed. Create a new one if the job restarts.";
    case "cancelled":
      return "Create a new hold when the buyer is ready to approve.";
    case "failed":
      return "Read the PayPal error, then try creating the order again.";
    default: {
      const neverStatus: never = deal.status;
      return neverStatus;
    }
  }
}

export function mockRewrite(deal: Deal): string {
  return `${explainDeal(deal)} Next step: ${nextStep(deal)}`;
}

export function statusLabel(status: DealStatus): string {
  switch (status) {
    case "created":
      return "Awaiting approval";
    case "approved":
      return "Approval received";
    case "authorized":
      return "On hold";
    case "captured":
      return "Released";
    case "voided":
      return "Voided";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

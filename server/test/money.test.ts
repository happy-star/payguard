import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, normalizeCurrency, parseAmount, toPaypalValue } from "../src/money";
import { paypalErrorMessage, pickApprovalUrl } from "../src/paypal/provider";

test("formats PayPal amounts with the currency's decimal rules", () => {
  assert.equal(toPaypalValue(parseAmount("$1,800.5"), "USD"), "1800.50");
  assert.equal(toPaypalValue(parseAmount("1800"), "JPY"), "1800");
  assert.equal(formatMoney("1800.00", "USD"), "$1,800.00");
  assert.throws(() => normalizeCurrency("US"), /3-letter/);
  assert.throws(() => normalizeCurrency("XXX"), /does not open holds/);
  assert.throws(() => parseAmount("0"), /greater than zero/);
});

test("picks the payer-action link and falls back to approve", () => {
  assert.equal(
    pickApprovalUrl([
      { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ABC" },
      { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ABC" },
    ]),
    "https://www.sandbox.paypal.com/checkoutnow?token=ABC",
  );
  assert.equal(
    pickApprovalUrl([{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=OLD" }]),
    "https://www.sandbox.paypal.com/checkoutnow?token=OLD",
  );
  assert.equal(pickApprovalUrl([{ rel: "self", href: "https://example.com" }]), null);
});

test("surfaces PayPal issue codes in a single sentence", () => {
  const message = paypalErrorMessage(
    422,
    {
      name: "UNPROCESSABLE_ENTITY",
      message: "The requested action could not be performed.",
      details: [{ issue: "ORDER_NOT_APPROVED", description: "Payer has not yet approved the Order." }],
    },
    "rejected the request.",
  );
  assert.match(message, /PayPal 422 ORDER_NOT_APPROVED/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { mockExtract } from "../src/ai/mockExtract";
import { samplePrompts } from "../src/samples";

const now = new Date("2026-11-05T12:00:00.000Z");

test("brand design sample extracts both parties, the fee, and two conditions", () => {
  const prompt = samplePrompts.find((sample) => sample.id === "brand")?.prompt ?? "";
  const extracted = mockExtract(prompt, now);
  assert.equal(extracted.amount, "1800.00");
  assert.equal(extracted.currency, "USD");
  assert.equal(extracted.freelancerName, "Maya Chen");
  assert.equal(extracted.buyerName, "Priya Shah");
  assert.equal(extracted.dueDate, "2026-11-20");
  assert.equal(extracted.confidence, "high");
  assert.equal(extracted.milestones.length, 2);
  assert.match(extracted.milestones[0]?.condition ?? "", /Figma/i);
  assert.match(extracted.milestones[1]?.condition ?? "", /exported assets/i);
  assert.equal(extracted.missing.length, 0);
  assert.ok(extracted.riskNotes.some((note) => /revision/i.test(note)));
  assert.equal(
    extracted.riskNotes.some((note) => /due date/i.test(note)),
    false,
  );
});

test("essay sample keeps one delivery condition and names the freelancer", () => {
  const prompt = samplePrompts.find((sample) => sample.id === "edit")?.prompt ?? "";
  const extracted = mockExtract(prompt, now);
  assert.equal(extracted.amount, "220.00");
  assert.equal(extracted.currency, "USD");
  assert.equal(extracted.freelancerName, "Jordan Lee");
  assert.equal(extracted.buyerName, "Buyer");
  assert.equal(extracted.dueDate, null);
  assert.equal(extracted.milestones.length, 1);
  assert.match(extracted.milestones[0]?.condition ?? "", /tracked changes/i);
  assert.ok(extracted.missing.includes("buyer name"));
  assert.ok(extracted.missing.includes("due date"));
  assert.equal(extracted.confidence, "medium");
});

test("csv sample warns that a split fee is still one PayPal hold", () => {
  const prompt = samplePrompts.find((sample) => sample.id === "csv")?.prompt ?? "";
  const extracted = mockExtract(prompt, now);
  assert.equal(extracted.amount, "950.00");
  assert.equal(extracted.currency, "USD");
  assert.equal(extracted.freelancerName, "Sam Okonkwo");
  assert.equal(extracted.milestones.length, 2);
  assert.match(extracted.milestones[0]?.condition ?? "", /sample file/i);
  assert.match(extracted.milestones[1]?.condition ?? "", /500 rows/i);
  assert.ok(extracted.riskNotes.some((note) => /one hold and one capture/i.test(note)));
  assert.ok(extracted.riskNotes.some((note) => /fuzzy/i.test(note)));
  assert.equal(extracted.confidence, "medium");
});

test("reads euros, an explicit due date, and a weekday", () => {
  const euros = mockExtract(
    "Logo for 80 EUR. I'm Alex Rivera, the client. Freelancer is Noor Rahman. Release when the SVG is in the shared folder. Due 2026-12-01.",
    now,
  );
  assert.equal(euros.amount, "80.00");
  assert.equal(euros.currency, "EUR");
  assert.equal(euros.buyerName, "Alex Rivera");
  assert.equal(euros.freelancerName, "Noor Rahman");
  assert.equal(euros.dueDate, "2026-12-01");

  const friday = mockExtract("A poster for £40 by Friday. Freelancer is Bea Costa.", now);
  assert.equal(friday.amount, "40.00");
  assert.equal(friday.currency, "GBP");
  assert.equal(friday.dueDate, "2026-11-06");
  assert.equal(friday.freelancerName, "Bea Costa");
});

test("a description without a price stays incomplete", () => {
  const extracted = mockExtract("Please design something nice for me soon.", now);
  assert.equal(extracted.amount, null);
  assert.equal(extracted.confidence, "low");
  assert.ok(extracted.missing.includes("amount"));
  assert.match(extracted.summary, /does not name a price/i);
});

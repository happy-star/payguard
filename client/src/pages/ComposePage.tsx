import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useHealth } from "@/components/Shell";
import { api } from "@/lib/api";
import { FALLBACK_CURRENCIES, messageFrom, readerLabel } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import type { AiSource, Confidence, Extraction, MilestoneDraft, SamplePrompt } from "@/types";

const DRAFT_KEY = "payguard.draft.v1";

interface FormState {
  title: string;
  summary: string;
  amount: string;
  currency: string;
  buyerName: string;
  freelancerName: string;
  dueDate: string;
  milestones: MilestoneDraft[];
  riskNotes: string[];
  missing: string[];
  confidence: Confidence;
  aiSource: AiSource;
}

export function ComposePage() {
  useTitle("New hold");
  const navigate = useNavigate();
  const health = useHealth();
  const reviewRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState(() => loadDraft().prompt);
  const [samples, setSamples] = useState<SamplePrompt[]>([]);
  const [form, setForm] = useState<FormState | null>(() => loadDraft().form);
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .samples()
      .then((result) => setSamples(result.samples))
      .catch(() => setSamples([]));
  }, []);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt, form }));
  }, [prompt, form]);

  const currencies = health?.currencies?.length ? health.currencies : FALLBACK_CURRENCIES;

  async function readTerms() {
    if (prompt.trim().length < 8) {
      setError("Describe the gig in at least a short sentence.");
      return;
    }
    setError(null);
    setReading(true);
    try {
      const extraction = await api.extract(prompt);
      setForm(toForm(extraction));
      requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setReading(false);
    }
  }

  async function createHold() {
    if (!form) return;
    setError(null);
    setCreating(true);
    try {
      const deal = await api.createDeal({
        prompt,
        title: form.title,
        summary: form.summary,
        amount: form.amount,
        currency: form.currency,
        buyerName: form.buyerName,
        freelancerName: form.freelancerName,
        dueDate: form.dueDate || null,
        milestones: form.milestones,
        riskNotes: form.riskNotes.filter((note) => note.trim()),
        missing: form.missing,
        confidence: form.confidence,
        aiSource: form.aiSource,
      });
      sessionStorage.removeItem(DRAFT_KEY);
      navigate(`/deals/${deal.id}`);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid gap-6">
        <header className="grid max-w-2xl gap-3">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Milestone holds</p>
          <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">
            Describe the job. The money waits until the work is accepted.
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            PayGuard pulls the fee, the people, and the acceptance checks out of a plain-language gig, then
            opens a PayPal authorization. Capture pays it out. Void gives it back.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-2xl">The gig, in your words</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void readTerms();
                }
              }}
              placeholder="Priya is hiring me, Jules Ortega, to design a one-page menu. $400. Release the hold when she approves the PDF."
              className="min-h-40 bg-card text-base md:text-base"
              aria-label="Gig description"
            />
            {samples.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {samples.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className="rounded-full border bg-background px-3 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => setPrompt(sample.prompt)}
                  >
                    <span className="font-medium text-foreground">{sample.label}</span>
                    <span className="text-muted-foreground"> · {sample.blurb}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {prompt.trim().length < 8
                ? "Write at least a short sentence. A few words is not enough to price a hold."
                : "Ctrl or Cmd + Enter reads the description."}
            </p>
            <Button
              type="button"
              data-testid="extract-terms"
              className="h-10 px-4"
              disabled={reading}
              onClick={() => void readTerms()}
            >
              {reading ? "Reading the description…" : "Extract terms"}
            </Button>
          </CardFooter>
        </Card>

        {error ? <Alert>{error}</Alert> : null}

        {form ? (
          <div ref={reviewRef}>
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Confirm the hold</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {readerLabel(form.aiSource)}. Confidence is {form.confidence}. Edit anything that looks off
                  before money can move.
                </p>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field label="Title" missing={flagged(form, "title")}>
                  <Input className="h-10 bg-card" value={form.title} onChange={(event) => patch(setForm, { title: event.target.value })} />
                </Field>
                <Field label="Summary">
                  <Textarea
                    className="min-h-20 bg-card"
                    value={form.summary}
                    onChange={(event) => patch(setForm, { summary: event.target.value })}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <Field label="Amount" missing={flagged(form, "amount")}>
                    <Input
                      className="h-10 bg-card"
                      inputMode="decimal"
                      value={form.amount}
                      onChange={(event) => patch(setForm, { amount: event.target.value })}
                    />
                  </Field>
                  <Field label="Currency">
                    <select
                      className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={form.currency}
                      onChange={(event) => patch(setForm, { currency: event.target.value })}
                    >
                      {currencies.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Buyer" missing={flagged(form, "buyer")}>
                    <Input
                      className="h-10 bg-card"
                      value={form.buyerName}
                      onChange={(event) => patch(setForm, { buyerName: event.target.value })}
                    />
                  </Field>
                  <Field label="Freelancer" missing={flagged(form, "freelancer")}>
                    <Input
                      className="h-10 bg-card"
                      value={form.freelancerName}
                      onChange={(event) => patch(setForm, { freelancerName: event.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Due date" missing={flagged(form, "due")}>
                  <Input
                    className="h-10 bg-card sm:max-w-xs"
                    type="date"
                    value={form.dueDate}
                    onChange={(event) => patch(setForm, { dueDate: event.target.value })}
                  />
                </Field>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>Acceptance conditions</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={form.milestones.length >= 4}
                      onClick={() =>
                        patch(setForm, {
                          milestones: [...form.milestones, { title: "New condition", condition: "" }],
                        })
                      }
                    >
                      Add condition
                    </Button>
                  </div>
                  {form.milestones.map((milestone, index) => (
                    <div key={index} className="grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-[180px_1fr_auto]">
                      <Input
                        aria-label={`Milestone ${index + 1} title`}
                        className="h-10 bg-card"
                        value={milestone.title}
                        onChange={(event) => updateMilestone(setForm, index, { title: event.target.value })}
                      />
                      <Input
                        aria-label={`Milestone ${index + 1} condition`}
                        className="h-10 bg-card"
                        value={milestone.condition}
                        onChange={(event) => updateMilestone(setForm, index, { condition: event.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={form.milestones.length === 1}
                        onClick={() =>
                          patch(setForm, { milestones: form.milestones.filter((_, item) => item !== index) })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    PayPal’s authorize intent allows one purchase unit, so this is a single hold and a single
                    capture, even when there are several conditions.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Risk notes</Label>
                  {form.riskNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing was flagged. You can still add a note.</p>
                  ) : (
                    form.riskNotes.map((note, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          aria-label={`Risk note ${index + 1}`}
                          className="h-10 bg-card"
                          value={note}
                          onChange={(event) => {
                            const riskNotes = form.riskNotes.slice();
                            riskNotes[index] = event.target.value;
                            patch(setForm, { riskNotes });
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => patch(setForm, { riskNotes: form.riskNotes.filter((_, item) => item !== index) })}
                        >
                          Remove
                        </Button>
                      </div>
                    ))
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={form.riskNotes.length >= 8}
                      onClick={() => patch(setForm, { riskNotes: [...form.riskNotes, ""] })}
                    >
                      Add risk note
                    </Button>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  type="button"
                  data-testid="create-hold"
                  className="h-11 px-5"
                  disabled={creating || !canCreate(form)}
                  onClick={() => void createHold()}
                >
                  {creating ? "Creating the hold…" : "Create authorization hold"}
                </Button>
              </CardFooter>
            </Card>
          </div>
        ) : null}
      </div>

      <aside className="grid gap-4 lg:sticky lg:top-24">
        <Card size="sm">
          <CardHeader>
            <CardTitle>What happens</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3 text-sm">
              <Step n="1" text="You describe the gig. The reader fills the fee, names, and conditions." />
              <Step n="2" text="You correct the terms. Nothing is sent to PayPal until you confirm." />
              <Step n="3" text="The buyer approves. Sandbox opens PayPal. Mock mode uses a stand-in screen." />
              <Step n="4" text="You capture the authorization when the work is accepted, or void it." />
            </ol>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Not a bank escrow</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            The order intent is AUTHORIZE. PayPal reserves the buyer’s funds, then capture settles them to the
            merchant on these API credentials. In a real freelance setup that merchant is the freelancer, or a
            platform account that pays them out.
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-2">
      <span className="font-serif text-base text-primary">{n}</span>
      <span className="leading-6">{text}</span>
    </li>
  );
}

function Field({
  label,
  missing,
  children,
}: {
  label: string;
  missing?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {missing ? <span className="text-xs text-muted-foreground">Not stated in the description</span> : null}
      </div>
      {children}
    </div>
  );
}

function loadDraft(): { prompt: string; form: FormState | null } {
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (!saved) return { prompt: "", form: null };
    const draft = JSON.parse(saved) as { prompt?: string; form?: FormState | null };
    return {
      prompt: typeof draft.prompt === "string" ? draft.prompt : "",
      form: draft.form ?? null,
    };
  } catch {
    return { prompt: "", form: null };
  }
}

function toForm(extraction: Extraction): FormState {
  return {
    title: extraction.title,
    summary: extraction.summary,
    amount: extraction.amount ?? "",
    currency: extraction.currency || "USD",
    buyerName: extraction.buyerName,
    freelancerName: extraction.freelancerName,
    dueDate: extraction.dueDate ?? "",
    milestones: extraction.milestones.length > 0 ? extraction.milestones : [{ title: "Work accepted", condition: "" }],
    riskNotes: extraction.riskNotes,
    missing: extraction.missing,
    confidence: extraction.confidence,
    aiSource: extraction.aiSource,
  };
}

function flagged(form: FormState, field: string): boolean {
  return form.missing.some((item) => item.toLowerCase().includes(field));
}

function canCreate(form: FormState): boolean {
  return (
    form.title.trim().length > 0 &&
    form.summary.trim().length > 0 &&
    form.amount.trim().length > 0 &&
    form.buyerName.trim().length > 0 &&
    form.freelancerName.trim().length > 0 &&
    form.milestones.every((milestone) => milestone.title.trim() && milestone.condition.trim())
  );
}

function patch(setForm: Dispatch<SetStateAction<FormState | null>>, partial: Partial<FormState>) {
  setForm((current) => (current ? { ...current, ...partial } : current));
}

function updateMilestone(
  setForm: Dispatch<SetStateAction<FormState | null>>,
  index: number,
  partial: Partial<MilestoneDraft>,
) {
  setForm((current) => {
    if (!current) return current;
    const milestones = current.milestones.map((milestone, item) =>
      item === index ? { ...milestone, ...partial } : milestone,
    );
    return { ...current, milestones };
  });
}

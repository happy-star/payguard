import type { Deal, Extraction, Health, SamplePrompt } from "@/types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("The server returned an unreadable response.", response.status);
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  samples: () => request<{ samples: SamplePrompt[] }>("/api/samples"),
  extract: (prompt: string) => request<Extraction>("/api/extract", { method: "POST", body: JSON.stringify({ prompt }) }),
  deals: () => request<{ deals: Deal[] }>("/api/deals"),
  deal: (id: string) => request<Deal>(`/api/deals/${id}`),
  createDeal: (body: Record<string, unknown>) =>
    request<Deal>("/api/deals", { method: "POST", body: JSON.stringify(body) }),
  retryOrder: (id: string) => request<Deal>(`/api/deals/${id}/order`, { method: "POST", body: "{}" }),
  approve: (id: string) => request<Deal>(`/api/deals/${id}/approve`, { method: "POST", body: "{}" }),
  authorize: (id: string) => request<Deal>(`/api/deals/${id}/authorize`, { method: "POST", body: "{}" }),
  capture: (id: string) => request<Deal>(`/api/deals/${id}/capture`, { method: "POST", body: "{}" }),
  voidHold: (id: string) => request<Deal>(`/api/deals/${id}/void`, { method: "POST", body: "{}" }),
  cancel: (id: string) => request<Deal>(`/api/deals/${id}/cancel`, { method: "POST", body: "{}" }),
  explain: (id: string) => request<Deal>(`/api/deals/${id}/explain`, { method: "POST", body: "{}" }),
  milestone: (id: string, milestoneId: string, done: boolean) =>
    request<Deal>(`/api/deals/${id}/milestones/${milestoneId}`, {
      method: "POST",
      body: JSON.stringify({ done }),
    }),
  seed: () => request<{ deals: Deal[] }>("/api/demo/seed", { method: "POST", body: "{}" }),
};

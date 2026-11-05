import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Deal } from "./types";

export function defaultDbPath(): string {
  return fileURLToPath(new URL("../../data/deals.json", import.meta.url));
}

export class DealStore {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]\n");
    }
  }

  read(): Deal[] {
    const raw = fs.readFileSync(this.filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Deal store is not a list.");
    }
    return parsed as Deal[];
  }

  get(id: string): Deal | undefined {
    return this.read().find((deal) => deal.id === id);
  }

  findByOrderId(orderId: string): Deal | undefined {
    return this.read().find((deal) => deal.paypal.orderId === orderId);
  }

  update<T>(mutate: (deals: Deal[]) => T): Promise<T> {
    const run = this.chain.then(() => {
      const deals = this.read();
      const result = mutate(deals);
      this.write(deals);
      return result;
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private write(deals: Deal[]) {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(deals, null, 2)}\n`);
    fs.renameSync(tmp, this.filePath);
  }
}

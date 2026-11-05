import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(here, "../../.env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file });
      return;
    }
  }
}

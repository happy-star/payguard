import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Alert({
  children,
  tone = "danger",
}: {
  children: ReactNode;
  tone?: "danger" | "note" | "ok";
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "note" && "border-border bg-secondary text-secondary-foreground",
        tone === "ok" && "border-primary/20 bg-accent text-accent-foreground",
      )}
    >
      {children}
    </div>
  );
}

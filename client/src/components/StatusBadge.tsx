import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealStatus } from "@/types";

const tones: Record<DealStatus, string> = {
  created: "border-transparent bg-accent text-accent-foreground",
  approved: "border-transparent bg-secondary text-secondary-foreground",
  authorized: "border-transparent bg-secondary text-secondary-foreground",
  captured: "border-transparent bg-primary text-primary-foreground",
  voided: "border-transparent bg-muted text-muted-foreground",
  cancelled: "border-transparent bg-muted text-muted-foreground",
  failed: "border-transparent bg-destructive/15 text-destructive",
};

export function StatusBadge({ status, className }: { status: DealStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-6 px-2", tones[status], className)}>
      {statusLabel(status)}
    </Badge>
  );
}

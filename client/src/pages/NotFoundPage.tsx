import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/lib/useTitle";

export function NotFoundPage() {
  useTitle("Not found");
  return (
    <div className="grid max-w-lg gap-3 py-10">
      <h1 className="font-serif text-4xl">That page is not part of PayGuard.</h1>
      <p className="text-sm text-muted-foreground">The hold you want is either on the ledger or still unwritten.</p>
      <div>
        <Button asChild>
          <Link to="/">Back to a new hold</Link>
        </Button>
      </div>
    </div>
  );
}

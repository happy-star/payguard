import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title === "PayGuard" ? title : `${title} · PayGuard`;
  }, [title]);
}

"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md rounded-xl border p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted-foreground">We could not load this page. Your data is safe. Try again, and if the problem continues contact your administrator{error.digest ? ` (ref ${error.digest})` : ""}.</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}

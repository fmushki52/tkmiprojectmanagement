"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/action";

/**
 * Runs a server action, shows a success/error toast and refreshes server data on success.
 * Returns the action result so forms can map field errors.
 */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; refresh?: boolean } = {}): Promise<ActionResult<T>> => {
      setPending(true);
      try {
        const res = await fn();
        if (res.ok) {
          if (opts.success) toast.success(opts.success);
          if (opts.refresh !== false) router.refresh();
        } else {
          toast.error(res.error);
        }
        return res;
      } catch (e) {
        console.error(e);
        toast.error("Something went wrong. Please try again.");
        return { ok: false, error: "Something went wrong. Please try again." };
      } finally {
        setPending(false);
      }
    },
    [router],
  );
  return { run, pending };
}

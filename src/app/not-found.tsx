import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may not exist, or you may not have access to it.</p>
        <Link href="/" className={cn(buttonVariants(), "mt-4")}>Go home</Link>
      </div>
    </main>
  );
}

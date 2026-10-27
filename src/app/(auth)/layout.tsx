import Image from "next/image";

/** Split screen like My Toloba: dark emerald brand panel on large screens, form on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen">
      <div className="relative hidden w-[45%] flex-col items-center justify-center overflow-hidden bg-sidebar p-12 lg:flex">
        <div aria-hidden className="absolute -top-24 -right-24 size-96 rounded-full bg-emerald-500/5" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-80 rounded-full bg-emerald-500/10" />
        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex size-24 items-center justify-center rounded-2xl bg-white/10 p-2">
            <Image src="/Kuwait_Logo.png" alt="" width={80} height={80} className="size-20 object-contain" priority />
          </div>
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-white">Project Tracker</h1>
          <p className="mx-auto max-w-xs text-base leading-relaxed text-white/60">
            Plan projects, track milestones and tasks, and report progress across your teams.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <div className="h-px w-12 bg-white/20" />
            <span className="text-xs tracking-widest text-white/30 uppercase">TKM – Kuwait</span>
            <div className="h-px w-12 bg-white/20" />
          </div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-xl bg-primary/10 p-2">
              <Image src="/Kuwait_Logo.png" alt="" width={48} height={48} className="size-12 object-contain" />
            </div>
            <h1 className="text-2xl font-bold">Project Tracker</h1>
            <p className="text-sm text-muted-foreground">TKM – Kuwait</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export function HomeHydrationSkeleton() {
  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-5xl px-4 pb-6 pt-2 sm:pb-12 sm:pt-8">
        <div className="space-y-4 lg:hidden">
          <div className="rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="ws-skeleton h-4 w-40 rounded-full" />
            <div className="mt-4 space-y-2">
              <div className="ws-skeleton h-12 rounded-[1.5rem]" />
              <div className="ws-skeleton h-12 w-[82%] rounded-[1.5rem]" />
            </div>
            <div className="mt-4 space-y-2">
              <div className="ws-skeleton h-4 rounded-full" />
              <div className="ws-skeleton h-4 w-[78%] rounded-full" />
            </div>
          </div>

          <div className="space-y-3 rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="ws-skeleton h-5 w-28 rounded-full" />
            <div className="ws-skeleton h-4 w-44 rounded-full" />
            <div className="ws-skeleton h-52 rounded-[1.3rem]" />
          </div>

          <div className="rounded-[1.6rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.78),rgba(226,232,240,0.5))]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ws-border-subtle)] px-4 py-3">
              <div className="ws-skeleton h-4 w-32 rounded-full" />
              <div className="ws-skeleton h-5 w-20 rounded-full" />
            </div>
            <div className="p-4">
              <div className="ws-skeleton h-64 rounded-[1.3rem]" />
            </div>
          </div>
        </div>

        <div className="hidden gap-5 sm:gap-6 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(21rem,0.95fr)] lg:items-start">
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="ws-skeleton h-5 w-52 rounded-full" />
              <div className="space-y-2">
                <div className="ws-skeleton h-20 rounded-[2rem]" />
                <div className="ws-skeleton h-20 w-[84%] rounded-[2rem]" />
              </div>
              <div className="space-y-2">
                <div className="ws-skeleton h-4 rounded-full" />
                <div className="ws-skeleton h-4 w-[72%] rounded-full" />
              </div>
            </div>

            <div className="space-y-3 rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
              <div className="ws-skeleton h-5 w-28 rounded-full" />
              <div className="ws-skeleton h-4 w-44 rounded-full" />
              <div className="ws-skeleton h-[25rem] rounded-[1.3rem]" />
            </div>
          </div>

          <div className="ws-hero-glass-card rounded-[1.65rem] p-[0.92rem] sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="ws-skeleton h-3 w-24 rounded-full" />
                <div className="ws-skeleton h-10 w-48 rounded-[1.1rem]" />
                <div className="ws-skeleton h-4 w-40 rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                <div className="ws-skeleton h-10 w-10 rounded-full" />
                <div className="ws-skeleton h-10 w-10 rounded-full" />
              </div>
            </div>

            <div className="mt-4 space-y-3.5">
              <div className="ws-skeleton h-11 w-36 rounded-2xl" />
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="ws-skeleton h-[4.5rem] rounded-[1.2rem]" />
                <div className="ws-skeleton h-[4.5rem] rounded-[1.2rem]" />
                <div className="ws-skeleton col-span-2 h-[4.5rem] rounded-[1.2rem]" />
              </div>
              <div className="ws-skeleton h-56 rounded-[1.25rem]" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

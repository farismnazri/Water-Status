export default function Subscriptions() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <section className="max-w-4xl mx-auto px-4 py-10 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Subscriptions
        </h1>

        <p className="text-sm text-slate-300 leading-relaxed">
          Water Status is imagined with simple, transparent tiers so anyone can
          start for free and upgrade only if they need more detail.
        </p>

        <ul className="text-sm text-slate-300 space-y-2">
          <li>
            <span className="font-semibold text-teal-300">Free</span> – basic
            access to public stations and simple charts.
          </li>
          <li>
            <span className="font-semibold text-teal-300">Plus</span> – more
            history, extra views and priority updates.
          </li>
          <li>
            <span className="font-semibold text-teal-300">Ultra</span> – rich
            analytics for farms, research projects and communities.
          </li>
        </ul>

        <p className="text-sm text-slate-400 leading-relaxed">
          Right now this is just a design idea. The live data and logic are
          still being built in the background.
        </p>
      </section>
    </main>
  );
}
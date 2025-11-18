export default function About() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <section className="max-w-4xl mx-auto px-4 py-10 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          About Water Status
        </h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          Water Status started from a simple frustration: most weather apps are
          too generic. People who live next to rivers, farms or in dense cities
          need to know what is happening <span className="text-teal-300">
          right where they are
          </span>, not somewhere 20&nbsp;km away.
        </p>
        <p className="text-sm text-slate-300 leading-relaxed">
          This prototype explores how we can combine{" "}
          <span className="text-teal-300">
            rain gauges, river level stations and temperature spots
          </span>{" "}
          into one clear view. In the future, it will also include{" "}
          community reports, photos and simple alerts.
        </p>
        <p className="text-sm text-slate-400 leading-relaxed">
          Long term, the goal is to support farmers, river neighbours and city
          users with tools that are simple, transparent and designed for the
          places they actually live in.
        </p>
      </section>
    </main>
  );
}
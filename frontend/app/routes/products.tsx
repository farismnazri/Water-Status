export default function Products() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <section className="max-w-4xl mx-auto px-4 py-10 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>

        <p className="text-sm text-slate-300 leading-relaxed">
          In the future, this space will show{" "}
          <span className="text-teal-300">
            real sensor kits and service bundles
          </span>{" "}
          that people can install at their farm, shop, river house or school.
        </p>

        <p className="text-sm text-slate-300 leading-relaxed">
          For now, you can explore the{" "}
          <span className="text-teal-300">virtual stations</span> on the{" "}
          <span className="underline">Stations</span> page to get a feeling of
          how the system could work with real devices: rain gauges, river level
          sensors and temperature nodes.
        </p>

        <p className="text-sm text-slate-400 leading-relaxed">
          Planned ideas include DIY sensor kits, ready-to-install packages and
          community bundles for kampungs and schools.
        </p>
      </section>
    </main>
  );
}
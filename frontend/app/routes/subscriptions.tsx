// app/routes/subscriptions.tsx
import { Link, redirect } from "react-router";

// If you want a real redirect, uncomment this loader:
export async function loader() {
  return redirect("/products");
}

// Optional: meta typing if you care later
// import type { Route } from "./+types/subscriptions";
// export function meta({}: Route.MetaArgs) {
//   return [{ title: "Subscriptions · Water Status" }];
// }

// This will almost never render because the loader redirects,
// but it's here as a fallback so the route is valid.
export default function SubscriptionsPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-3xl mx-auto px-4 py-10 space-y-4">
        <h1 className="text-2xl font-semibold">Subscriptions moved</h1>
        <p className="text-sm text-slate-600">
          Subscription plans now live under the{" "}
          <Link to="/products" className="text-sky-600 underline">
            Products
          </Link>{" "}
          page.
        </p>
      </section>
    </main>
  );
}
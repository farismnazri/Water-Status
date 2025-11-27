// app/routes/cart.tsx
// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/cart";

type CartItem = {
  id: string;
  name: string;
  price: string;
  quantity?: number;
};

// same helper pattern as in products.tsx
function getCartKeyForUser(userId: string | null) {
  return userId ? `wsCart:${userId}` : "wsCart:guest";
}

const API_BASE = "http://127.0.0.1:8000";

function parsePriceToNumber(priceStr: string): number {
  const match = priceStr.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Cart · Water Status" },
    {
      name: "description",
      content:
        "View the IoT sensor bundles and plans you’ve added to your Water Status cart.",
    },
  ];
}

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("Guest");

  // 🔹 Load active user (same source as header/products)
  useEffect(() => {
    if (typeof window === "undefined") return;

    function refreshActiveUser() {
      try {
        const raw = window.localStorage.getItem("wsActiveUser");
        if (!raw) {
          setUserId(null);
          setUserName("Guest");
          return;
        }
        const saved = JSON.parse(raw);
        setUserId(saved?.id ?? null);
        setUserName(saved?.name || "Guest");
      } catch {
        setUserId(null);
        setUserName("Guest");
      }
    }

    refreshActiveUser();

    const handler = () => refreshActiveUser();
    window.addEventListener("ws-active-user-changed", handler);

    const storageHandler = (e: StorageEvent) => {
      if (e.key === "wsActiveUser") refreshActiveUser();
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      window.removeEventListener("ws-active-user-changed", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  // 🔹 Load cart whenever userId changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const key = getCartKeyForUser(userId);
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    }
  }, [userId]);

  // 🔹 Save + keep UI + header badge in sync
  function saveCart(next: CartItem[]) {
    if (typeof window === "undefined") return;
    const key = getCartKeyForUser(userId);
    window.localStorage.setItem(key, JSON.stringify(next));
    setItems(next);
    window.dispatchEvent(new Event("ws-cart-updated"));
  }

  function handleRemove(id: string) {
    const next = items.filter((it) => it.id !== id);
    saveCart(next);
  }

  function handleChangeQuantity(id: string, delta: number) {
    const next = items
      .map((it) =>
        it.id === id
          ? { ...it, quantity: Math.max(1, (it.quantity ?? 1) + delta) }
          : it
      )
      .filter((it) => (it.quantity ?? 1) > 0);
    saveCart(next);
  }

    async function handleCheckout() {
    if (!items.length) return;

    try {
      const payload = {
        items: items.map((it) => ({
          name: it.name,
          price: parsePriceToNumber(it.price),
          quantity: it.quantity ?? 1,
        })),
      };

      const res = await fetch(`${API_BASE}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error("Checkout failed", res.status);
        alert("Could not start checkout.");
        return;
      }

      const data = await res.json();
      if (data.url) {
        // 🔁 Redirect user to Stripe Checkout
        window.location.href = data.url;
      } else {
        alert("Checkout session did not return a URL.");
      }
    } catch (err) {
      console.error(err);
      alert("Something went wrong starting checkout.");
    }
  }

  const totalItems = items.reduce(
    (sum, it) => sum + (it.quantity ?? 1),
    0
  );

  // very simple price parser (from "RM 9.99")
  const totalPrice = items.reduce((sum, it) => {
    const match = it.price.match(/([\d.]+)/);
    const num = match ? parseFloat(match[1]) : 0;
    return sum + num * (it.quantity ?? 1);
  }, 0);

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="ws-card p-6 space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Cart
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight">
            Your cart
          </h1>
          <p className="text-xs text-slate-600">
            {userName === "Guest"
              ? "You are browsing as Guest. Set an active user on the Users page to keep carts separate."
              : `Cart for ${userName}`}
          </p>
        </div>

        {/* Cart body */}
        <div className="ws-card p-6 space-y-4">
          {items.length === 0 ? (
            <p className="text-xs text-slate-600">
              Your cart is empty. Go to{" "}
              <Link to="/products" className="text-sky-600 underline">
                Products
              </Link>{" "}
              and add a sensor bundle.
            </p>
          ) : (
            <>
              <ul className="space-y-3 text-xs">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--ws-border-subtle)] pb-2"
                  >
                    <div>
                      <p className="font-semibold text-slate-800">
                        {it.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {it.price}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleChangeQuantity(it.id, -1)}
                        className="h-6 w-6 rounded-full border border-[var(--ws-border-subtle)] text-slate-700 text-xs hover:bg-slate-100"
                      >
                        −
                      </button>
                      <span className="min-w-[2rem] text-center text-[11px]">
                        {it.quantity ?? 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleChangeQuantity(it.id, +1)}
                        className="h-6 w-6 rounded-full border border-[var(--ws-border-subtle)] text-slate-700 text-xs hover:bg-slate-100"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(it.id)}
                        className="text-[11px] px-2 py-1 rounded-full border border-rose-200 text-rose-600 bg-rose-50 hover:bg-rose-100 transition"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs pt-2 border-t border-[var(--ws-border-subtle)]">
  <span className="text-slate-600">
    {totalItems} item{totalItems === 1 ? "" : "s"}
  </span>
  <div className="flex items-center gap-3">
    <span className="font-semibold text-slate-800">
      Approx total: RM {totalPrice.toFixed(2)}
    </span>
    <button
      type="button"
      onClick={handleCheckout}
      className="px-3 py-1.5 rounded-full bg-sky-600 text-white text-[11px] font-medium hover:bg-sky-700 transition"
    >
      Checkout (test)
    </button>
  </div>
</div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
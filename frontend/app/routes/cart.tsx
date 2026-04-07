// app/routes/cart.tsx
// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/cart";

type CartItem = {
  id: string;
  name: string;
  price: string;
  image?: string;
  quantity?: number;
};

// same helper pattern as in products.tsx
function getCartKeyForUser(userId: string | null) {
  return userId ? `wsCart:${userId}` : "wsCart:guest";
}

const PRODUCT_IMAGE_BY_ID: Record<string, string> = {
  "starter-kit": "/images/basic.png",
  "neighbour-bundle": "/images/bundle.png",
  "community-pack": "/images/superbundle.png",
};

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

  function getItemImage(item: CartItem): string | null {
    if (item.image) return item.image;
    return PRODUCT_IMAGE_BY_ID[item.id] || null;
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
      <section className="max-w-5xl mx-auto px-4 py-6 space-y-5 sm:py-10 sm:space-y-6">
        {/* Header */}
        <div className="ws-card p-5 space-y-2 sm:p-6">
          <h1 className="text-xl sm:text-3xl font-semibold leading-tight tracking-tight">
              {userName === "Guest"
              ? "You are browsing as Guest. Set an active user on the Users page to keep carts separate."
              : `Cart for ${userName}`}
          </h1>
        </div>

        {/* Cart body */}
        <div className="ws-card p-5 space-y-4 sm:p-6">
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
              <ul className="space-y-4 text-xs">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="ws-card-panel flex flex-col gap-4 rounded-[1.4rem] p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {getItemImage(it) ? (
                        <img
                          src={getItemImage(it)!}
                          alt={it.name}
                          width={128}
                          height={128}
                          loading="lazy"
                          decoding="async"
                          className="ws-card-panel-soft h-24 w-24 rounded-xl object-contain p-2 sm:h-32 sm:w-32"
                        />
                      ) : (
                        <div className="ws-card-panel-soft h-12 w-12 rounded-lg" />
                      )}
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-slate-800 truncate">
                          {it.name}
                        </p>
                        <p className="text-lg text-slate-500 sm:text-[30px]">
                          {it.price}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => handleChangeQuantity(it.id, -1)}
                        className="ws-card-pill h-6 w-6 rounded-full text-slate-700 text-xs"
                      >
                        −
                      </button>
                      <span className="min-w-[2.25rem] text-center text-[11px] font-medium">
                        {it.quantity ?? 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleChangeQuantity(it.id, +1)}
                        className="ws-card-pill h-6 w-6 rounded-full text-slate-700 text-xs"
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

              <div className="flex flex-col gap-4 border-t border-[var(--ws-border-subtle)] pt-4 text-xs sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <span className="block text-slate-600">
                    {totalItems} item{totalItems === 1 ? "" : "s"}
                  </span>
                  <p className="max-w-xl text-slate-600 leading-relaxed">
                    Your cart is a preview for now. The full support flow is
                    still on the way, but this is the future we&apos;re building
                    together.
                  </p>
                </div>

                <div className="flex flex-col items-start gap-3 sm:items-end">
                  <span className="text-lg font-semibold text-slate-800 sm:text-[20px]">
                    Approx total: RM {totalPrice.toFixed(2)}
                  </span>
                  <Link to="/about" className="ws-button-primary text-xs">
                    Help us build this
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

// app/components/CartBadge.tsx
import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";

type CartItem = {
  id: string;
  name: string;
  price: string;
};

export function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function refreshCart() {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem("wsCartItems");
        const arr: CartItem[] = raw ? JSON.parse(raw) : [];
        setCount(Array.isArray(arr) ? arr.length : 0);
      } catch {
        setCount(0);
      }
    }

    // Initial load
    refreshCart();

    if (typeof window !== "undefined") {
      const handler = () => refreshCart();

      window.addEventListener("ws-cart-updated", handler);
      window.addEventListener("storage", (e) => {
        if (e.key === "wsCartItems") refreshCart();
      });

      return () => {
        window.removeEventListener("ws-cart-updated", handler);
      };
    }
  }, []);

  if (count === 0) return null;

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900"
      title="Items in cart"
    >
      <ShoppingCart className="w-4 h-4" />
      <span className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-full bg-sky-600 text-[10px] font-semibold text-white">
        {count}
      </span>
    </button>
  );
}
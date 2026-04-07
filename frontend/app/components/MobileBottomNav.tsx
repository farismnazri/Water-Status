import { House, MapPinned, Menu } from "lucide-react";
import { NavLink } from "react-router";

type MobileBottomNavProps = {
  cartCount: number;
  menuActive: boolean;
  onOpenMenu: () => void;
};

export function MobileBottomNav({
  cartCount,
  menuActive,
  onOpenMenu,
}: MobileBottomNavProps) {
  return (
    <nav className="ws-mobile-bottom-nav ws-safe-bottom lg:hidden">
      <div className="mx-auto flex w-full max-w-md items-center gap-1 px-3">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            [
              "ws-mobile-bottom-nav-item",
              isActive
                ? "bg-sky-600 text-white shadow-[0_8px_18px_rgba(2,132,199,0.22)]"
                : "text-slate-600 hover:bg-sky-50 hover:text-sky-700",
            ].join(" ")
          }
        >
          <House className="h-4 w-4" />
          <span>Home</span>
        </NavLink>

        <NavLink
          to="/sensors"
          className={({ isActive }) =>
            [
              "ws-mobile-bottom-nav-item",
              isActive
                ? "bg-sky-600 text-white shadow-[0_8px_18px_rgba(2,132,199,0.22)]"
                : "text-slate-600 hover:bg-sky-50 hover:text-sky-700",
            ].join(" ")
          }
        >
          <MapPinned className="h-4 w-4" />
          <span>Stations</span>
        </NavLink>

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={
            cartCount > 0
              ? `Open menu, ${cartCount} items in cart`
              : "Open menu"
          }
          className={[
            "ws-mobile-bottom-nav-item relative",
            menuActive
              ? "bg-sky-600 text-white shadow-[0_8px_18px_rgba(2,132,199,0.22)]"
              : "text-slate-600 hover:bg-sky-50 hover:text-sky-700",
          ].join(" ")}
        >
          <Menu className="h-4 w-4" />
          <span>Menu</span>
          {cartCount > 0 ? (
            <span className="absolute right-2.5 top-1.5 inline-flex min-w-[1.05rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-semibold text-white">
              {cartCount}
            </span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}

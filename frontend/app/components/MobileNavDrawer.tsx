import { Drawer } from "@base-ui/react/drawer";
import { ArrowRight, Menu, X } from "lucide-react";
import { Link, NavLink } from "react-router";

type NavItem = {
  to: string;
  label: string;
};

type ActiveUser = {
  id: string | null;
  name: string;
  plan: string | null;
};

type MobileNavDrawerProps = {
  activeUser: ActiveUser;
  cartCount: number;
  navItems: NavItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function MobileNavDrawer({
  activeUser,
  cartCount,
  navItems,
  open,
  setOpen,
}: MobileNavDrawerProps) {
  return (
    <Drawer.Root
      modal
      open={open}
      onOpenChange={setOpen}
      swipeDirection="right"
    >
      <Drawer.Trigger
        aria-label="Open navigation menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-slate-700 transition hover:bg-[var(--ws-accent-alt)]/70"
        type="button"
      >
        <Menu className="h-4 w-4" />
      </Drawer.Trigger>

      <Drawer.Portal keepMounted>
        <Drawer.Backdrop
          className={[
            "fixed inset-0 z-40 bg-slate-950/34 backdrop-blur-[2px] transition-opacity duration-200",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
        />

        <Drawer.Popup
          className={[
            "fixed inset-y-0 right-0 z-50 flex w-[min(88vw,20rem)] max-w-sm flex-col overflow-y-auto border-l border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,247,252,0.98))] px-4 pb-6 pt-5 shadow-[0_20px_60px_rgba(15,23,42,0.22)] backdrop-blur-xl transition-transform duration-300 ease-out",
            open ? "translate-x-0" : "pointer-events-none translate-x-full",
          ].join(" ")}
        >
          <Drawer.Title className="sr-only">Navigation menu</Drawer.Title>
          <Drawer.Description className="sr-only">
            Browse Water Status pages and account details.
          </Drawer.Description>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="ws-logo-circle inline-flex h-8 w-8 items-center justify-center text-sm font-bold">
                W
              </span>
              <div>
                <p className="text-sm font-semibold tracking-tight text-slate-900">
                  Water Status
                </p>
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  Mobile menu
                </p>
              </div>
            </div>

            <Drawer.Close
              aria-label="Close navigation menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-white/82 text-slate-700 transition hover:bg-[var(--ws-accent-alt)]/75"
              type="button"
            >
              <X className="h-4 w-4" />
            </Drawer.Close>
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-slate-200/80 bg-white/78 px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Signed in as
            </p>
            <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
              {activeUser.name || "Guest"}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">
              {activeUser.plan ? `${activeUser.plan} plan` : "Guest access"}
            </p>
          </div>

          <nav className="mt-6 flex flex-col gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  [
                    "flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-medium transition",
                    isActive
                      ? "border-[var(--ws-accent-soft)] bg-[var(--ws-accent)]/92 text-slate-950 shadow-sm"
                      : "border-slate-200/80 bg-white/78 text-slate-700 hover:border-[var(--ws-accent-soft)] hover:bg-[var(--ws-accent-alt)]/75",
                  ].join(" ")
                }
                end={item.to === "/"}
              >
                <span>{item.label}</span>
                <ArrowRight className="h-4 w-4 opacity-70" />
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto pt-6">
            <Link
              to="/cart"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/78 px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition hover:border-[var(--ws-accent-soft)] hover:bg-[var(--ws-accent-alt)]/75"
            >
              <span>Open cart</span>
              {cartCount > 0 ? (
                <span className="min-w-[1.5rem] rounded-full bg-emerald-500 px-2 py-0.5 text-center text-[11px] font-semibold text-white">
                  {cartCount}
                </span>
              ) : (
                <ArrowRight className="h-4 w-4 opacity-70" />
              )}
            </Link>
          </div>
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

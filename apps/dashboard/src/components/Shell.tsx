import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, ApiError, type SessionUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

const links = [
  { to: "/servers", label: "Servers" },
  { to: "/chat", label: "Chat" },
  { to: "/audit", label: "Audit" },
  { to: "/team", label: "Team" },
];

export function Shell() {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.me().then(setUser).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) return;
      setError(reason instanceof Error ? reason.message : "Could not load the session");
    });
  }, []);

  if (!user && !error) {
    return <p className="px-6 py-10 text-sm text-ink-soft">Opening the gate…</p>;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper-2/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <NavLink to="/servers" className="font-serif text-xl tracking-tight">
            Urumi Gate
          </NavLink>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-ink-soft",
                    isActive && "bg-seal-soft text-seal",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? (
              <>
                <div className="text-right">
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs uppercase tracking-wide text-ink-soft">{user.role}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void api.logout().finally(() => navigate("/login"));
                  }}
                >
                  Sign out
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {user?.storeMode === "fixture" ? (
          <p className="mb-4 rounded-md border border-line bg-paper-2 px-3 py-2 text-sm text-ink-soft">
            The WooCommerce tools are on the local fixture store. Deploy the Helm chart to point the same server at a
            real storefront.
          </p>
        ) : null}
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        {user ? <Outlet context={user} /> : null}
      </main>
    </div>
  );
}

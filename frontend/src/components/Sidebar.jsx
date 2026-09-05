import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { FEATURE_ROUTES, NAV_GROUPS } from "../featureRoutes.js";

const LABELS_APP_URL = "https://spicetown-server.tailcc1217.ts.net:8443/";

const ROUTES_BY_FEATURE = Object.fromEntries(FEATURE_ROUTES.map((r) => [r.feature, r]));

const COLLAPSE_STORAGE_KEY = "spicetown_sidebar_collapsed";

function ChevronIcon({ open }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s", flexShrink: 0 }}
    >
      <path d="M4 2 L8 6 L4 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar() {
  const { user, logout, hasFeature } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Desktop-only collapse, independent of the mobile drawer above - remembered
  // across visits since it's a standing layout preference, not per-session.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  // Auto-open whichever group contains the current page, so navigating
  // straight to a sub-item (a bookmark, a link from another page) never
  // leaves it hidden inside a collapsed group with no visual cue.
  useEffect(() => {
    for (const group of NAV_GROUPS) {
      if (group.type !== "group") continue;
      const items = group.features.map((f) => ROUTES_BY_FEATURE[f]).filter(Boolean);
      if (items.some((item) => (item.end ? location.pathname === item.path : location.pathname.startsWith(item.path)))) {
        setExpandedGroups((prev) => (prev.has(group.key) ? prev : new Set(prev).add(group.key)));
      }
    }
  }, [location.pathname]);

  function closeMobileNav() {
    setOpen(false);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function toggleGroup(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function navLinkClass({ isActive }) {
    return isActive ? "active" : undefined;
  }

  return (
    <>
      <button
        className="sidebar-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "✕" : "☰"}
      </button>
      {open && <div className="sidebar-backdrop" onClick={closeMobileNav} />}
      {collapsed && (
        <button className="sidebar-expand-btn" aria-label="Expand menu" onClick={toggleCollapsed}>
          »
        </button>
      )}
      <nav className={`sidebar${open ? " sidebar-open" : ""}${collapsed ? " sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand">
          <img src="/logo-header.png" alt="Spice Town" />
          <span>Spice Town</span>
          <button className="sidebar-collapse-btn" aria-label="Collapse menu" onClick={toggleCollapsed}>
            «
          </button>
        </div>
        <div className="sidebar-nav">
          {NAV_GROUPS.map((entry) => {
            if (entry.type === "item") {
              const route = ROUTES_BY_FEATURE[entry.feature];
              if (!route || !hasFeature(route.feature)) return null;
              return (
                <NavLink key={route.path} to={route.path} end={route.end} onClick={closeMobileNav} className={navLinkClass}>
                  {route.label}
                </NavLink>
              );
            }

            const items = entry.features.map((f) => ROUTES_BY_FEATURE[f]).filter((r) => r && hasFeature(r.feature));
            if (items.length === 0) return null;
            const isOpen = expandedGroups.has(entry.key);
            return (
              <div className="sidebar-group" key={entry.key}>
                <button
                  type="button"
                  className="sidebar-group-toggle"
                  onClick={() => toggleGroup(entry.key)}
                  aria-expanded={isOpen}
                >
                  <ChevronIcon open={isOpen} />
                  {entry.label}
                </button>
                {isOpen && (
                  <div className="sidebar-subnav">
                    {items.map((route) => (
                      <NavLink key={route.path} to={route.path} end={route.end} onClick={closeMobileNav} className={navLinkClass}>
                        {route.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* External tool, not part of this app's feature-grant system at
              all (no shared auth/API) - visible to every logged-in user
              regardless of dashboard permissions, same as it was as an
              Overview card, just also reachable directly from here now. */}
          <a
            className="sidebar-external-link"
            href={LABELS_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMobileNav}
          >
            Label Scanner ↗
          </a>

          {user?.is_admin && (
            <NavLink to="/users" onClick={closeMobileNav} className={navLinkClass}>
              Users
            </NavLink>
          )}
          <NavLink to="/change-password" onClick={closeMobileNav} className={navLinkClass}>
            Change Password
          </NavLink>
          {hasFeature("help") && (
            <NavLink to="/help" onClick={closeMobileNav} className={navLinkClass}>
              Help
            </NavLink>
          )}
        </div>
        <div className="sidebar-footer">
          {user && (
            <div style={{ marginBottom: "0.5rem" }}>
              Signed in as <strong style={{ color: "var(--sidebar-text-active)" }}>{user.username}</strong>
              {user.is_admin && " (admin)"}
            </div>
          )}
          <button
            onClick={logout}
            style={{
              background: "none",
              border: "1px solid var(--sidebar-border)",
              color: "var(--sidebar-text)",
              width: "100%",
              padding: "0.4rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.82rem",
            }}
          >
            Log out
          </button>
        </div>
      </nav>
    </>
  );
}

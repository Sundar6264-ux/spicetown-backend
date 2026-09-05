import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getMe, login as apiLogin, logout as apiLogout } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, []);

  async function login(username, password) {
    const me = await apiLogin(username, password);
    setUser(me);
    return me;
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  // Admin always has full access; a non-admin only sees what's in their own
  // allowed_features (set by an admin on the Users page). Same rule the
  // backend enforces per-endpoint (app/features.py) - this is purely for
  // hiding nav/routes the API would 403 on anyway, not a security boundary
  // of its own.
  function hasFeature(key) {
    if (!user) return false;
    if (user.is_admin) return true;
    return (user.allowed_features || []).includes(key);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, hasFeature }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

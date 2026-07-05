import { Link2, LogOut, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authApi } from "../services/api";
import { toast } from "./ui/toast";

export function FyersConnect() {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<{ userName: string; broker: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const checkSession = useCallback(async () => {
    const sessionId = localStorage.getItem("fyersSessionId");
    if (!sessionId) {
      setConnected(false);
      setUser(null);
      return;
    }

    try {
      const result = await authApi.checkSession(sessionId);
      if (result.valid) {
        setConnected(true);
        setUser(result.user);
      } else {
        localStorage.removeItem("fyersSessionId");
        setConnected(false);
        setUser(null);
      }
    } catch {
      localStorage.removeItem("fyersSessionId");
      setConnected(false);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    checkSession();

    const handleLogout = () => {
      setConnected(false);
      setUser(null);
    };
    window.addEventListener("fyers:logout", handleLogout);
    return () => window.removeEventListener("fyers:logout", handleLogout);
  }, [checkSession]);

  useEffect(() => {
    const hash = window.location.hash;
    const hashParams = hash.startsWith("#") ? hash.slice(1) : hash;
    const params = new URLSearchParams(hashParams || window.location.search);
    const authCode = params.get("auth_code");
    const state = params.get("state");

    if (authCode) {
      // CSRF guard: only proceed if `state` matches what THIS browser stored when it itself
      // called handleLogin() below. Without this, opening an attacker-crafted link like
      // .../#auth_code=<attacker_code>&state=<anything> would silently exchange it and connect
      // this browser to the attacker's FYERS identity — no click beyond navigating needed. A
      // login this browser never started has nothing to compare against, so it's rejected
      // outright. The backend enforces the same check server-side (the real security boundary);
      // this is defense-in-depth so a hijack attempt never even reaches the network call.
      const expectedState = sessionStorage.getItem("fyersOAuthState");
      sessionStorage.removeItem("fyersOAuthState");
      if (!state || !expectedState || state !== expectedState) {
        toast.error("FYERS login could not be verified — please click Connect FYERS again.", { id: "fyers-auth" });
        window.history.replaceState({}, "", window.location.pathname);
        window.location.hash = "";
        return;
      }
      setLoading(true);
      authApi
        .exchangeToken(authCode, state)
        .then((result) => {
          localStorage.setItem("fyersSessionId", result.sessionId);
          setConnected(true);
          setUser(result.user);
          window.history.replaceState({}, "", window.location.pathname);
          toast.success(`Connected to FYERS as ${result.user?.userName ?? "trader"}`, { id: "fyers-auth" });
        })
        .catch((err) => {
          toast.error("FYERS login failed: " + err.message, { id: "fyers-auth" });
          window.location.hash = "";
        })
        .finally(() => setLoading(false));
    }
  }, []);

  const handleLogin = async () => {
    window.location.hash = "";
    setLoading(true);
    try {
      const { loginUrl, state } = await authApi.getLoginUrl();
      // Stored so the callback handler above can verify the state that comes back is the one
      // THIS browser actually requested — see the CSRF guard there for why this matters.
      if (state) sessionStorage.setItem("fyersOAuthState", state);
      window.location.href = loginUrl;
    } catch (err: any) {
      toast.error("Failed to get login URL: " + err.message, { id: "fyers-auth" });
      setLoading(false);
    }
  };

  const handleLogout = () => {
    authApi.logout();
    setConnected(false);
    setUser(null);
  };

  if (connected && user) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-gain/20 bg-gain-dim px-3 py-1.5">
        <Shield size={13} className="text-gain" />
        <div className="flex flex-col leading-none">
          <span className="text-2xs font-medium text-zinc-200">{user.userName}</span>
          <span className="text-2xs text-zinc-500">{user.broker}</span>
        </div>
        <button
          onClick={handleLogout}
          className="ml-1 rounded p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-loss"
          title="Disconnect FYERS"
        >
          <LogOut size={12} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-panel border border-border bg-panel px-3 py-1.5 text-2xs font-medium text-zinc-400 transition hover:border-border-hover hover:text-zinc-200 disabled:opacity-50"
    >
      <Link2 size={12} />
      {loading ? "Connecting…" : "Connect FYERS"}
    </button>
  );
}
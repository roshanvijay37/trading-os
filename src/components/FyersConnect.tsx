import { Link2, LogOut, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authApi, isFyersConnected } from "../services/api";

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

  // Handle OAuth callback (auth_code in URL hash)
  useEffect(() => {
    // FYERS redirects with auth_code in hash fragment (#?auth_code=...)
    const hash = window.location.hash;
    const hashParams = hash.startsWith("#") ? hash.slice(1) : hash;
    const params = new URLSearchParams(hashParams || window.location.search);
    const authCode = params.get("auth_code");
    const state = params.get("state");
    const status = params.get("status");

    if (authCode) {
      setLoading(true);
      authApi
        .exchangeToken(authCode, state || undefined)
        .then((result) => {
          localStorage.setItem("fyersSessionId", result.sessionId);
          setConnected(true);
          setUser(result.user);
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch((err) => {
          alert("FYERS login failed: " + err.message);
          // Clear stale hash so user can retry
          window.location.hash = "";
        })
        .finally(() => setLoading(false));
    }
  }, []);

  const handleLogin = async () => {
    // Clear any old hash to prevent reprocessing stale auth codes
    window.location.hash = "";
    setLoading(true);
    try {
      const { loginUrl } = await authApi.getLoginUrl();
      window.location.href = loginUrl;
    } catch (err: any) {
      alert("Failed to get login URL: " + err.message);
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
      <div className="flex items-center gap-3 rounded-xl border border-lime-400/20 bg-lime-400/10 px-4 py-2.5">
        <Shield size={16} className="text-lime-400" />
        <div className="flex flex-col">
          <span className="text-xs font-medium text-lime-300">
            {user.userName}
          </span>
          <span className="text-[10px] text-lime-400/60">{user.broker}</span>
        </div>
        <button
          onClick={handleLogout}
          className="ml-2 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-300"
          title="Disconnect FYERS"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
    >
      <Link2 size={15} />
      {loading ? "Connecting…" : "Connect FYERS"}
    </button>
  );
}
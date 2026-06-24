import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { storage } from "../services/storage";
import { toLocalDateKey } from "../utils/date";

export function Constitution() {
  const [agreed, setAgreed] = useState(false);
  const navigate = useNavigate();

  const accept = () => {
    if (!agreed) return;
    storage.acceptConstitution(toLocalDateKey());
    navigate("/", { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-5 text-zinc-200">
      <section className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-900 p-7 shadow-glow sm:p-10">
        <span className="inline-flex rounded-2xl bg-lime-400 p-3 text-zinc-950">
          <ShieldCheck size={28} />
        </span>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.25em] text-lime-300">
          Daily Constitution
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          Sign in to discipline.
        </h1>
        <div className="mt-8 space-y-4 border-y border-zinc-800 py-7 text-lg leading-8 text-zinc-300">
          <p>I do not need one big trade.</p>
          <p>I need 1000 disciplined trades.</p>
          <p>I will risk 1%.</p>
        </div>
        <label className="mt-7 flex cursor-pointer items-start gap-3 text-sm leading-6 text-zinc-400">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            className="mt-1 h-4 w-4 accent-lime-400"
          />
          I accept that a rule-following trade is a good trade, regardless of P&amp;L.
        </label>
        <button
          type="button"
          disabled={!agreed}
          onClick={accept}
          className="mt-7 w-full rounded-xl bg-lime-400 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Accept for today
        </button>
      </section>
    </main>
  );
}

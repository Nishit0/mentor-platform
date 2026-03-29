"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function AuthPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/dashboard";
  const supabase = getSupabaseBrowserClient();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"mentor" | "student">("student");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.replace(redirectTo);
      }
    });
  }, [redirectTo, router, supabase.auth]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role,
            full_name: fullName.trim(),
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setMessage("Signup completed. Please log in with your new account.");
          setMode("login");
          setLoading(false);
          return;
        }
      }

      router.replace(redirectTo);
      router.refresh();
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 py-10 text-slate-100">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[2rem] border border-slate-800 bg-[#0d1728]/95 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="inline-flex rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300">
            Private mentorship workspace
          </div>
          <h1 className="mt-6 max-w-lg text-4xl font-semibold leading-tight text-slate-50">
            1-on-1 coding sessions for mentors and students.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-400">
            Join a private session, talk live, exchange messages, and collaborate in a shared editor built for focused technical mentorship.
          </p>

          <div className="mt-8 grid gap-3 text-sm text-slate-300">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">Private mentor-student rooms</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">Live video, chat, and shared code editor</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">Role-based access for mentors and students</div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-800 bg-[#0d1728]/95 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <h2 className="text-2xl font-semibold text-slate-50">Mentor Platform</h2>
          <p className="mt-2 text-sm text-slate-400">Access your mentor or student workspace.</p>

          <div className="mt-6 flex gap-2 rounded-2xl bg-slate-950/80 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-xl px-3 py-2 ${mode === "login" ? "bg-slate-100 text-slate-950" : "text-slate-300"}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-xl px-3 py-2 ${mode === "signup" ? "bg-slate-100 text-slate-950" : "text-slate-300"}`}
            >
              Signup
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" ? (
              <label className="grid gap-2 text-sm">
                <span className="text-slate-300">Full name</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-slate-500"
                />
              </label>
            ) : null}

            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-slate-500"
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-slate-500"
              />
            </label>

            {mode === "signup" ? (
              <label className="grid gap-2 text-sm">
                <span className="text-slate-300">Role</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as "mentor" | "student")}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-slate-500"
                >
                  <option className="bg-slate-950 text-slate-100" value="mentor">Mentor</option>
                  <option className="bg-slate-950 text-slate-100" value="student">Student</option>
                </select>
              </label>
            ) : null}

            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            {message ? <p className="text-sm text-emerald-300">{message}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-950 transition hover:bg-white disabled:opacity-60"
            >
              {loading ? "Please wait" : mode === "login" ? "Login" : "Create account"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

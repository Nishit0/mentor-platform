"use client";

import { FormEvent, SVGProps, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBaseUrl } from "@/lib/api";
import { getUserDisplayName, getUserRole, type AppRole } from "@/lib/auth";
import { defaultMediaPreferences, readMediaPreferences, writeMediaPreferences } from "@/lib/mediaPreferences";
import { getSupabaseBrowserClient } from "@/lib/supabase";

function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

function MicOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m4 4 16 16" />
      <path d="M9 5.4A3 3 0 0 1 15 6v4" />
      <path d="M9 9v3a3 3 0 0 0 4.28 2.72" />
      <path d="M5 10v2a7 7 0 0 0 11.3 5.5" />
      <path d="M12 19v3" />
    </svg>
  );
}

function CameraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15 10 19.55 7.72A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" />
      <rect x="3" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CameraOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m4 4 16 16" />
      <path d="M10.5 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5" />
      <path d="M15 10 20 7.5v9" />
    </svg>
  );
}

function extractRoomId(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  const directMatch = trimmedValue.match(/session-[a-z0-9-]+/i);
  if (directMatch) {
    return directMatch[0].toLowerCase();
  }

  try {
    const parsedUrl = new URL(trimmedValue.includes("://") ? trimmedValue : `http://${trimmedValue}`);
    const urlMatch = `${parsedUrl.pathname}${parsedUrl.search}`.match(/session-[a-z0-9-]+/i);
    return urlMatch ? urlMatch[0].toLowerCase() : "";
  } catch {
    return "";
  }
}

async function parseApiResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(response.ok ? "Invalid server response." : "Server returned an unexpected response.");
  }
}

export default function Home() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [role, setRole] = useState<AppRole | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaPreferences, setMediaPreferences] = useState(defaultMediaPreferences);

  useEffect(() => {
    setMediaPreferences(readMediaPreferences());

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const nextRole = getUserRole(user);
      if (!user || !nextRole) {
        await supabase.auth.signOut();
        router.replace("/");
        return;
      }

      setRole(nextRole);
      setDisplayName(getUserDisplayName(user));
      setLoading(false);
    };

    loadUser();
  }, [router, supabase.auth]);

  const updateMediaPreferences = (key: "audioEnabled" | "videoEnabled") => {
    setMediaPreferences((current) => {
      const nextValue = {
        ...current,
        [key]: !current[key],
      };

      writeMediaPreferences(nextValue);
      return nextValue;
    });
  };

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
    const shouldRefresh = !session?.access_token || !expiresAt || expiresAt - Date.now() < 60_000;

    if (!shouldRefresh && session?.access_token) {
      return session.access_token;
    }

    const {
      data: { session: refreshedSession },
      error,
    } = await supabase.auth.refreshSession();

    if (error || !refreshedSession?.access_token) {
      await supabase.auth.signOut();
      router.replace("/");
      throw new Error("Please log in again.");
    }

    return refreshedSession.access_token;
  };

  const buildDebugError = async (accessToken: string, fallbackMessage: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/debug-auth`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await parseApiResponse(response);
      if (response.ok) {
        return fallbackMessage;
      }
      return `${fallbackMessage} (${data.reason || data.error || "debug failed"})`;
    } catch {
      return fallbackMessage;
    }
  };

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (role !== "mentor") {
      setError("Only mentors can create sessions.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const accessToken = await getAccessToken();
      const response = await fetch(`${getApiBaseUrl()}/api/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      const data = await parseApiResponse(response);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(await buildDebugError(accessToken, data.error || "Authentication required."));
        }
        throw new Error(data.error || "Unable to create session.");
      }

      router.push(`/session/${data.room_id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create session.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setSubmitting(true);
      setError(null);
      const accessToken = await getAccessToken();
      const roomId = extractRoomId(joinRoomId);
      if (!roomId) {
        throw new Error("Enter a valid room id or invite link.");
      }
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${roomId}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await parseApiResponse(response);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(await buildDebugError(accessToken, data.error || "Authentication required."));
        }
        throw new Error(data.error || "Unable to join session.");
      }

      router.push(`/session/${data.room_id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to join session.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/auth");
    router.refresh();
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07111f] text-white">
        <p>Loading account...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07111f] px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between rounded-[1.75rem] border border-slate-800 bg-[#0d1728]/95 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Mentor Platform</h1>
            <p className="mt-2 text-sm text-slate-400">
              Signed in as {displayName} ({role}).
            </p>
          </div>
          <button onClick={handleLogout} className="rounded-xl bg-slate-100 px-4 py-2 text-slate-950">
            Logout
          </button>
        </header>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        <section className="space-y-4 rounded-[1.75rem] border border-slate-800 bg-[#0d1728]/95 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div>
            <h2 className="text-xl font-semibold text-slate-50">Join preferences</h2>
            <p className="mt-2 text-sm text-slate-400">Choose your devices before entering the session.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => updateMediaPreferences("audioEnabled")}
              className={`inline-flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition ${mediaPreferences.audioEnabled ? "border-slate-600 bg-slate-100 text-slate-950" : "border-slate-700 bg-slate-950 text-slate-200"}`}
            >
              {mediaPreferences.audioEnabled ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4" />}
              <span>{mediaPreferences.audioEnabled ? "Microphone ready" : "Microphone muted"}</span>
            </button>
            <button
              type="button"
              onClick={() => updateMediaPreferences("videoEnabled")}
              className={`inline-flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition ${mediaPreferences.videoEnabled ? "border-slate-600 bg-slate-100 text-slate-950" : "border-slate-700 bg-slate-950 text-slate-200"}`}
            >
              {mediaPreferences.videoEnabled ? <CameraIcon className="h-4 w-4" /> : <CameraOffIcon className="h-4 w-4" />}
              <span>{mediaPreferences.videoEnabled ? "Camera ready" : "Camera off"}</span>
            </button>
          </div>
        </section>

        {role === "mentor" ? (
          <form onSubmit={handleCreateSession} className="space-y-4 rounded-[1.75rem] border border-slate-800 bg-[#0d1728]/95 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
            <h2 className="text-xl font-semibold text-slate-50">Start session</h2>
            <button type="submit" disabled={submitting} className="rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-950 disabled:opacity-60">
              {submitting ? "Starting..." : "Start session"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoinSession} className="space-y-4 rounded-[1.75rem] border border-slate-800 bg-[#0d1728]/95 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
            <h2 className="text-xl font-semibold text-slate-50">Join mentor session</h2>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Invite link or room id</span>
              <input
                value={joinRoomId}
                onChange={(event) => setJoinRoomId(event.target.value)}
                placeholder="session-abc123 or paste invite link"
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-slate-500"
              />
            </label>
            <button type="submit" disabled={submitting} className="rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-950 disabled:opacity-60">
              {submitting ? "Joining..." : "Join session"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ChatBox from "@/components/ChatBox";
import CodeEditor from "@/components/CodeEditor";
import VideoCall from "@/components/VideoCall";
import { getApiBaseUrl } from "@/lib/api";
import { getUserDisplayName, getUserRole, type AppRole } from "@/lib/auth";
import { setSocketAccessToken, socket } from "@/lib/socket";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Participant = {
  id: string;
  name: string;
  role: AppRole;
};

export default function SessionPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const roomId = params.roomId;

  const [role, setRole] = useState<AppRole | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [endingSession, setEndingSession] = useState(false);
  const [leavingSession, setLeavingSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const handleParticipantList = (nextParticipants: Participant[]) => {
      if (!cancelled) {
        setParticipants(nextParticipants);
      }
    };

    const handleRoomError = (message: string) => {
      if (!cancelled) {
        setSessionError(message);
      }
    };

    const handleSessionEnded = (message: string) => {
      if (cancelled) {
        return;
      }

      setSessionError(message);
      window.setTimeout(() => {
        router.push("/dashboard");
      }, 1200);
    };

    const initialize = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace(`/auth?redirectTo=/session/${roomId}`);
        return;
      }

      const nextRole = getUserRole(session.user);
      if (!nextRole) {
        await supabase.auth.signOut();
        router.replace("/");
        return;
      }

      if (cancelled) {
        return;
      }

      setRole(nextRole);
      setDisplayName(getUserDisplayName(session.user));
      setSocketAccessToken(session.access_token);

      socket.off("participant-list", handleParticipantList);
      socket.off("room-full");
      socket.off("room-error", handleRoomError);
      socket.off("session-ended", handleSessionEnded);

      socket.on("participant-list", handleParticipantList);
      socket.on("room-full", () => handleRoomError("This session already has a mentor and a student."));
      socket.on("room-error", handleRoomError);
      socket.on("session-ended", handleSessionEnded);

      socket.connect();
      socket.emit("join-room", { roomId });
      setLoading(false);
    };

    initialize();

    return () => {
      cancelled = true;
      socket.off("participant-list", handleParticipantList);
      socket.off("room-full");
      socket.off("room-error", handleRoomError);
      socket.off("session-ended", handleSessionEnded);
      socket.disconnect();
      setSocketAccessToken(null);
    };
  }, [roomId, router, supabase.auth]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return `${window.location.origin}/session/${roomId}`;
  }, [roomId]);

  const handleCopyInvite = async () => {
    if (!shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleEndSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace(`/?redirectTo=/session/${roomId}`);
      return;
    }

    setEndingSession(true);
    setSessionError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${roomId}/end`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to end session.");
      }

      router.push("/dashboard");
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to end session.");
      setEndingSession(false);
    }
  };

  const handleLeaveSession = async () => {
    setLeavingSession(true);
    setSessionError(null);

    try {
      socket.emit("leave-room", { roomId });
    } finally {
      socket.disconnect();
      setSocketAccessToken(null);
      router.push("/dashboard");
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07111f] text-white">
        <p>Loading session...</p>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 text-white">
        <div className="max-w-xl rounded-[1.75rem] border border-slate-800 bg-slate-950/90 p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-semibold">Session unavailable</h1>
          <p className="mt-4 text-slate-300">{sessionError}</p>
          <button onClick={() => router.push("/")} className="mt-6 rounded-xl bg-slate-100 px-5 py-3 text-slate-950">
            Back
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#07111f] px-3 py-3 text-slate-100">
      <div className="mx-auto flex h-full w-full max-w-[1760px] flex-col gap-2">
        <header className="flex w-full shrink-0 items-center justify-between gap-4 rounded-[1.3rem] border border-slate-800 bg-[#0d1728]/95 px-4 py-2 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-base font-semibold text-slate-50">Room {roomId}</h1>
              <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                {role}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{displayName}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {participants.map((participant) => (
                <div key={participant.id} className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-0.5 text-[10px] text-slate-200">
                  {participant.name}
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {role === "mentor" ? (
              <>
                <button onClick={handleCopyInvite} className="rounded-lg border border-slate-700 bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-white">
                  {copied ? "Invite copied" : "Copy invite link"}
                </button>
                <button
                  onClick={handleEndSession}
                  disabled={endingSession}
                  className="rounded-lg border border-red-500/30 bg-red-950/40 px-3.5 py-1.5 text-xs font-medium text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {endingSession ? "Ending..." : "End session"}
                </button>
              </>
            ) : (
              <button
                onClick={handleLeaveSession}
                disabled={leavingSession}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3.5 py-1.5 text-xs font-medium text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {leavingSession ? "Leaving..." : "Leave session"}
              </button>
            )}
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.66fr)_minmax(320px,0.44fr)] grid-rows-[minmax(0,1fr)_auto] gap-2">
          <div className="min-h-0 overflow-hidden rounded-[1.3rem] border border-slate-800 bg-[#0d1728]/88 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
            <CodeEditor roomId={roomId} />
          </div>
          <div className="row-span-2 min-h-0 overflow-hidden rounded-[1.3rem] border border-slate-800 bg-[#0d1728]/88 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
            <ChatBox roomId={roomId} userName={displayName} userRole={role ?? "student"} />
          </div>
          <div className="min-h-0 overflow-hidden rounded-[1.3rem] border border-slate-800 bg-[#0d1728]/88 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
            <VideoCall roomId={roomId} />
          </div>
        </section>
      </div>
    </main>
  );
}

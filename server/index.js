import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import http from "http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors({ origin: "*" }));
app.use(express.json());

const roomState = new Map();
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwks = supabaseUrl ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)) : null;
const DISCONNECT_GRACE_MS = 12_000;
const EMPTY_ROOM_CLEANUP_MS = 5 * 60_000;

function getInitialRoomState(durationMinutes = 60, startedAt = new Date().toISOString()) {
  return {
    code: `function solve(input) {
  return input
    .trim()
    .split("\n")
    .map((line) => line.toUpperCase());
}

console.log(solve("mentor\nstudent"));
`,
    language: "javascript",
    chatHistory: [],
    participants: new Map(),
    durationMinutes,
    startedAt,
    disconnectTimers: new Map(),
    roomCleanupTimer: null,
    sessionTimeoutTimer: null,
  };
}

function createSystemMessage(text) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderName: "System",
    text,
    type: "system",
    createdAt: new Date().toISOString(),
  };
}

function getUniqueParticipants(participantsMap) {
  const seen = new Map();
  for (const participant of participantsMap.values()) {
    if (!seen.has(participant.userId)) {
      seen.set(participant.userId, {
        id: participant.userId,
        name: participant.name,
        role: participant.role,
      });
    }
  }
  return Array.from(seen.values());
}

function createRoomId() {
  return `session-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeDuration(value) {
  if (!Number.isFinite(value) || value < 15) {
    return 60;
  }

  return Math.min(180, Math.round(value));
}

function getUserRole(payload) {
  const role = payload?.user_metadata?.role;
  return role === "mentor" || role === "student" ? role : null;
}

function getUserName(payload) {
  return payload?.user_metadata?.full_name || payload?.email || "User";
}

function encodeFilterValue(value) {
  return String(value).replace(/,/g, "%2C");
}

function hasUserPresence(state, userId) {
  for (const participant of state.participants.values()) {
    if (participant.userId === userId) {
      return true;
    }
  }
  return false;
}

function removeParticipantSocketsForUser(state, userId, keepSocketId) {
  const removedSocketIds = [];
  for (const [socketId, participant] of state.participants.entries()) {
    if (participant.userId === userId && socketId !== keepSocketId) {
      state.participants.delete(socketId);
      removedSocketIds.push(socketId);
    }
  }
  return removedSocketIds;
}

function clearRoomCleanupTimer(state) {
  if (state.roomCleanupTimer) {
    clearTimeout(state.roomCleanupTimer);
    state.roomCleanupTimer = null;
  }
}

function cancelPendingDisconnect(state, userId) {
  const pendingTimer = state.disconnectTimers.get(userId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    state.disconnectTimers.delete(userId);
  }
}

function clearSessionTimeoutTimer(state) {
  if (state.sessionTimeoutTimer) {
    clearTimeout(state.sessionTimeoutTimer);
    state.sessionTimeoutTimer = null;
  }
}

function deleteRoomState(roomId) {
  const state = roomState.get(roomId);
  if (!state) {
    return;
  }

  clearRoomCleanupTimer(state);
  clearSessionTimeoutTimer(state);
  for (const pendingTimer of state.disconnectTimers.values()) {
    clearTimeout(pendingTimer);
  }
  state.disconnectTimers.clear();
  roomState.delete(roomId);
}

function scheduleRoomCleanup(roomId, state) {
  clearRoomCleanupTimer(state);
  state.roomCleanupTimer = setTimeout(() => {
    deleteRoomState(roomId);
  }, EMPTY_ROOM_CLEANUP_MS);
}

async function verifyAccessToken(accessToken) {
  if (!supabaseUrl || !supabaseAnonKey || !jwks) {
    return { user: null, reason: "Server Supabase env is missing." };
  }

  if (!accessToken) {
    return { user: null, reason: "Access token missing." };
  }

  try {
    const { payload } = await jwtVerify(accessToken, jwks, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
    });

    const role = getUserRole(payload);
    if (!role) {
      return { user: null, reason: "Role missing from token metadata." };
    }

    return {
      user: {
        id: payload.sub,
        role,
        name: getUserName(payload),
        email: typeof payload.email === "string" ? payload.email : null,
        user_metadata: payload.user_metadata,
      },
      reason: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Token verification failed.";
    return { user: null, reason };
  }
}

async function supabaseRest(pathName, { method = "GET", accessToken, query, body, useServiceRole = false } = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${pathName}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
  }

  const apiKey = useServiceRole && supabaseServiceRoleKey ? supabaseServiceRoleKey : supabaseAnonKey;
  const authorizationToken = useServiceRole && supabaseServiceRoleKey ? supabaseServiceRoleKey : accessToken;

  const response = await fetch(url, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${authorizationToken}`,
      ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error || "Supabase request failed.";
    throw new Error(message);
  }

  return data;
}

async function fetchSessionByRoomId(accessToken, roomId) {
  const data = await supabaseRest("sessions", {
    accessToken,
    useServiceRole: true,
    query: {
      select: "*",
      room_id: `eq.${encodeFilterValue(roomId)}`,
      limit: "1",
    },
  });

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

function getSessionExpiryTime(session) {
  const anchor = session.started_at || session.scheduled_at;
  if (!anchor) {
    return null;
  }

  const startedAt = new Date(anchor).getTime();
  if (!Number.isFinite(startedAt)) {
    return null;
  }

  return startedAt + normalizeDuration(Number(session.duration_minutes ?? 60)) * 60_000;
}

async function endSessionRecord(roomId, endedAt = new Date().toISOString()) {
  try {
    const updated = await supabaseRest("sessions", {
      method: "PATCH",
      useServiceRole: true,
      query: {
        select: "*",
        room_id: `eq.${encodeFilterValue(roomId)}`,
        status: "not.in.(ended,cancelled)",
      },
      body: {
        status: "ended",
        ended_at: endedAt,
      },
    });

    return Array.isArray(updated) && updated.length > 0 ? updated[0] : null;
  } catch {
    return null;
  }
}

async function ensureSessionIsAvailable(accessToken, roomId) {
  const session = await fetchSessionByRoomId(accessToken, roomId);
  if (!session) {
    return null;
  }

  if (session.status === "ended" || session.status === "cancelled") {
    return session;
  }

  const expiryTime = getSessionExpiryTime(session);
  if (expiryTime && expiryTime <= Date.now()) {
    const endedSession = await endSessionRecord(roomId);
    return endedSession || { ...session, status: "ended" };
  }

  return session;
}

async function activateSessionIfNeeded(accessToken, session) {
  if (session.status !== "scheduled") {
    return session;
  }

  const updated = await supabaseRest("sessions", {
    method: "PATCH",
    accessToken,
    useServiceRole: true,
    query: {
      select: "*",
      room_id: `eq.${encodeFilterValue(session.room_id)}`,
    },
    body: {
      status: "active",
      started_at: session.started_at || new Date().toISOString(),
    },
  });

  return Array.isArray(updated) && updated.length > 0 ? updated[0] : session;
}

function scheduleSessionTimeout(roomId, state, session) {
  clearSessionTimeoutTimer(state);

  const startedAt = session.started_at || session.scheduled_at || state.startedAt || new Date().toISOString();
  const durationMinutes = normalizeDuration(Number(session.duration_minutes ?? state.durationMinutes));
  const expiresAt = new Date(startedAt).getTime() + durationMinutes * 60_000;
  const delay = Math.max(0, expiresAt - Date.now());

  state.startedAt = startedAt;
  state.durationMinutes = durationMinutes;
  state.sessionTimeoutTimer = setTimeout(async () => {
    const currentState = roomState.get(roomId);
    if (!currentState) {
      return;
    }

    await endSessionRecord(roomId);
    const timeoutMessage = createSystemMessage("Session timed out.");
    currentState.chatHistory.push(timeoutMessage);
    io.to(roomId).emit("receive-message", timeoutMessage);
    io.to(roomId).emit("session-ended", "This session timed out.");
    deleteRoomState(roomId);
  }, delay);
}

function finalizeUserDeparture(roomId, userId, userName, { socketId, emitLeaveMessage = true } = {}) {
  const state = roomState.get(roomId);
  if (!state) {
    return;
  }

  cancelPendingDisconnect(state, userId);
  const removedSocketIds = removeParticipantSocketsForUser(state, userId, null);
  if (socketId && !removedSocketIds.includes(socketId)) {
    removedSocketIds.push(socketId);
  }

  if (removedSocketIds.length === 0) {
    return;
  }

  removedSocketIds.forEach((removedSocketId) => {
    io.to(roomId).emit("cursor-remove", removedSocketId);
  });

  io.to(roomId).emit("participant-list", getUniqueParticipants(state.participants));
  io.to(roomId).emit("peer-left");

  if (emitLeaveMessage) {
    const leaveMessage = createSystemMessage(`${userName} left the session.`);
    state.chatHistory.push(leaveMessage);
    io.to(roomId).emit("receive-message", leaveMessage);
  }

  if (state.participants.size === 0) {
    scheduleRoomCleanup(roomId, state);
  }
}

async function authFromRequest(req, res, next) {
  const authorization = req.headers.authorization;
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const { user, reason } = await verifyAccessToken(accessToken);

  if (!user) {
    res.status(401).json({ error: "Authentication required.", reason });
    return;
  }

  req.accessToken = accessToken;
  req.user = user;
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/debug-auth", authFromRequest, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post("/api/sessions", authFromRequest, async (req, res) => {
  try {
    if (req.user.role !== "mentor") {
      res.status(403).json({ error: "Only mentors can create sessions." });
      return;
    }

    const roomId = createRoomId();
    const scheduledAt = req.body?.scheduledAt || new Date().toISOString();
    const durationMinutes = normalizeDuration(Number(req.body?.durationMinutes ?? 60));

    const data = await supabaseRest("sessions", {
      method: "POST",
      accessToken: req.accessToken,
      useServiceRole: true,
      body: {
        room_id: roomId,
        mentor_id: req.user.id,
        status: "scheduled",
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
      },
    });

    res.status(201).json(Array.isArray(data) ? data[0] : data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to create session." });
  }
});

app.post("/api/sessions/:roomId/join", authFromRequest, async (req, res) => {
  try {
    if (req.user.role !== "student") {
      res.status(403).json({ error: "Only students can join a session." });
      return;
    }

    const session = await ensureSessionIsAvailable(req.accessToken, req.params.roomId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    if (session.status === "ended" || session.status === "cancelled") {
      res.status(409).json({ error: "This session is no longer available." });
      return;
    }

    if (session.mentor_id === req.user.id) {
      res.status(403).json({ error: "Mentors cannot join as student." });
      return;
    }

    if (session.student_id && session.student_id !== req.user.id) {
      res.status(409).json({ error: "A student has already joined this session." });
      return;
    }

    if (session.student_id === req.user.id) {
      res.json(session);
      return;
    }

    const updated = await supabaseRest("sessions", {
      method: "PATCH",
      accessToken: req.accessToken,
      useServiceRole: true,
      query: {
        select: "*",
        room_id: `eq.${encodeFilterValue(req.params.roomId)}`,
        student_id: "is.null",
      },
      body: {
        student_id: req.user.id,
        status: "active",
        started_at: session.started_at || new Date().toISOString(),
      },
    });

    if (!Array.isArray(updated) || updated.length === 0) {
      res.status(409).json({ error: "Session join failed. Please try again." });
      return;
    }

    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to join session." });
  }
});

app.post("/api/sessions/:roomId/end", authFromRequest, async (req, res) => {
  try {
    const session = await ensureSessionIsAvailable(req.accessToken, req.params.roomId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    if (session.mentor_id !== req.user.id && session.student_id !== req.user.id) {
      res.status(403).json({ error: "Only session participants can end the session." });
      return;
    }

    if (session.status === "ended") {
      res.json(session);
      return;
    }

    const updated = await supabaseRest("sessions", {
      method: "PATCH",
      accessToken: req.accessToken,
      useServiceRole: true,
      query: {
        select: "*",
        room_id: `eq.${encodeFilterValue(req.params.roomId)}`,
      },
      body: {
        status: "ended",
        ended_at: new Date().toISOString(),
      },
    });

    const payload = Array.isArray(updated) ? updated[0] : updated;
    const state = roomState.get(req.params.roomId);
    if (state) {
      const endMessage = createSystemMessage("Session ended.");
      state.chatHistory.push(endMessage);
      io.to(req.params.roomId).emit("receive-message", endMessage);
      io.to(req.params.roomId).emit("session-ended", "This session has ended.");
      deleteRoomState(req.params.roomId);
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to end session." });
  }
});

io.use(async (socket, next) => {
  const accessToken = socket.handshake.auth?.accessToken;
  const { user, reason } = await verifyAccessToken(accessToken);

  if (!user) {
    next(new Error(reason || "Authentication required."));
    return;
  }

  socket.data.accessToken = accessToken;
  socket.data.userId = user.id;
  socket.data.userRole = user.role;
  socket.data.userName = user.name;
  next();
});

io.on("connection", (socket) => {
  socket.on("join-room", async ({ roomId }) => {
    try {
      if (!roomId) {
        socket.emit("room-error", "A valid room id is required.");
        return;
      }

      const userRole = socket.data.userRole;
      const userId = socket.data.userId;
      const userName = socket.data.userName;
      const accessToken = socket.data.accessToken;
      let session = await ensureSessionIsAvailable(accessToken, roomId);

      if (!session) {
        socket.emit("room-error", "Session not found.");
        return;
      }

      if (session.status === "ended" || session.status === "cancelled") {
        socket.emit("room-error", "This session is no longer available.");
        return;
      }

      if (userRole === "mentor") {
        session = await activateSessionIfNeeded(accessToken, session);
      }

      if (userRole === "mentor" && session.mentor_id !== userId) {
        socket.emit("room-error", "Only the assigned mentor can open this session.");
        return;
      }

      if (userRole === "student" && session.student_id !== userId) {
        socket.emit("room-error", "Join the session first from the dashboard.");
        return;
      }

      let state = roomState.get(roomId);
      if (!state) {
        state = getInitialRoomState(
          session.duration_minutes,
          session.started_at || session.scheduled_at || new Date().toISOString(),
        );
        roomState.set(roomId, state);
      }

      clearRoomCleanupTimer(state);
      cancelPendingDisconnect(state, userId);
      scheduleSessionTimeout(roomId, state, session);

      const userAlreadyPresent = hasUserPresence(state, userId);
      const existingParticipant = getUniqueParticipants(state.participants).find((participant) => participant.id === userId);
      if (!existingParticipant && getUniqueParticipants(state.participants).length >= 2) {
        socket.emit("room-full");
        return;
      }

      removeParticipantSocketsForUser(state, userId, socket.id);
      socket.join(roomId);
      socket.data.roomId = roomId;

      state.participants.set(socket.id, {
        socketId: socket.id,
        userId,
        role: userRole,
        name: userName,
      });

      socket.emit("role", userRole === "mentor" ? "initiator" : "receiver");
      socket.emit("chat-history", state.chatHistory);
      socket.emit("code-state", { code: state.code, language: state.language });
      io.to(roomId).emit("participant-list", getUniqueParticipants(state.participants));

      if (!userAlreadyPresent) {
        const joinMessage = createSystemMessage(`${userName} joined as ${userRole}.`);
        state.chatHistory.push(joinMessage);
        io.to(roomId).emit("receive-message", joinMessage);
      }

      if (getUniqueParticipants(state.participants).length === 2) {
        io.to(roomId).emit("peer-ready");
      }
    } catch {
      socket.emit("room-error", "Unable to join session room.");
    }
  });

  socket.on("leave-room", ({ roomId }) => {
    const activeRoomId = roomId || socket.data.roomId;
    if (!activeRoomId) {
      return;
    }

    finalizeUserDeparture(activeRoomId, socket.data.userId, socket.data.userName ?? "Participant", {
      socketId: socket.id,
      emitLeaveMessage: true,
    });

    socket.leave(activeRoomId);
    delete socket.data.roomId;
  });

  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", offer);
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", answer);
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", candidate);
  });

  socket.on("send-message", ({ roomId, text, type }) => {
    const state = roomState.get(roomId);
    if (!state) {
      return;
    }

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderName: socket.data.userName,
      senderRole: socket.data.userRole,
      text,
      type,
      createdAt: new Date().toISOString(),
    };

    state.chatHistory.push(message);
    io.to(roomId).emit("receive-message", message);
  });

  socket.on("code-change", ({ roomId, code }) => {
    const state = roomState.get(roomId);
    if (!state) {
      return;
    }

    state.code = code;
    socket.to(roomId).emit("code-update", code);
  });

  socket.on("language-change", ({ roomId, language, code }) => {
    const state = roomState.get(roomId);
    if (!state) {
      return;
    }

    state.language = language;
    state.code = code;
    io.to(roomId).emit("language-update", language);
    socket.to(roomId).emit("code-update", code);
  });

  socket.on("cursor-change", ({ roomId, position }) => {
    socket.to(roomId).emit("cursor-update", {
      socketId: socket.id,
      userName: socket.data.userName ?? "Collaborator",
      position,
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const state = roomState.get(roomId);
    if (!state) {
      return;
    }

    if (state.disconnectTimers.has(socket.data.userId)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      finalizeUserDeparture(roomId, socket.data.userId, socket.data.userName ?? "Participant", {
        socketId: socket.id,
        emitLeaveMessage: true,
      });
    }, DISCONNECT_GRACE_MS);

    state.disconnectTimers.set(socket.data.userId, timeoutId);
  });
});

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});

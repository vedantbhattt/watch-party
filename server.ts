import { createServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { clampPosition, isValidRoomCode, normalizeDisplayName, normalizeMediaUrl, normalizeRoomCode } from "./lib/validation";
import type {
  Ack,
  ChatMessage,
  ClientToServerEvents,
  Participant,
  PlaylistItem,
  GroupPoll,
  RoomSnapshot,
  ServerToClientEvents,
} from "./lib/protocol";

type InternalParticipant = Participant & {
  socketId?: string;
  disconnectTimer?: ReturnType<typeof setTimeout>;
};

type InternalRoom = {
  code: string;
  hostParticipantId: string;
  movieTitle: string;
  mediaUrl: string;
  isPlaying: boolean;
  anchorPosition: number;
  updatedAt: number;
  revision: number;
  createdAt: number;
  participants: Map<string, InternalParticipant>;
  messages: ChatMessage[];
  pauseVotes: Set<string>;
  playlist: PlaylistItem[];
  polls: GroupPoll[];
};

type SocketData = {
  clientId?: string;
  roomCode?: string;
  rateLimits?: Map<string, { startedAt: number; count: number }>;
};

type InterServerEvents = Record<string, never>;

const productionArg = process.argv.includes("--production");
const dev = !productionArg && process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "localhost";
const port = Number(process.env.PORT || 3000);
const rooms = new Map<string, InternalRoom>();
const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DISCONNECT_GRACE_MS = 30_000;
const MAX_ROOM_SIZE = 25;
const MAX_CHAT_LENGTH = 500;

function makeCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[randomInt(chars.length)];
  return code;
}

function currentPosition(room: InternalRoom) {
  const elapsed = room.isPlaying ? (Date.now() - room.updatedAt) / 1000 : 0;
  return Math.max(0, Math.min(24 * 60 * 60, room.anchorPosition + elapsed));
}

function pauseVoteThreshold(room: InternalRoom) {
  // The host is not eligible to vote. A strict majority of connected guests is
  // enough; with one guest, that guest's request is sufficient.
  const eligibleGuests = Array.from(room.participants.values()).filter(
    (participant) => participant.connected && participant.id !== room.hostParticipantId,
  ).length;
  return Math.max(1, Math.floor(eligibleGuests / 2) + 1);
}

function snapshot(room: InternalRoom): RoomSnapshot {
  return {
    code: room.code,
    hostParticipantId: room.hostParticipantId,
    movieTitle: room.movieTitle,
    mediaUrl: room.mediaUrl,
    isPlaying: room.isPlaying,
    position: currentPosition(room),
    serverNow: Date.now(),
    revision: room.revision,
    participants: Array.from(room.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostParticipantId,
      connected: p.connected,
    })),
    messages: room.messages.slice(-60),
    pauseVoteParticipantIds: Array.from(room.pauseVotes),
    pauseVoteThreshold: pauseVoteThreshold(room),
    playlist: room.playlist.map((item) => ({ ...item })),
    polls: room.polls.map((poll) => ({ ...poll, options: [...poll.options], votes: { ...poll.votes } })),
  };
}

function clockTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function addSystemMessage(room: InternalRoom, text: string): ChatMessage {
  const item: ChatMessage = {
    id: randomUUID(),
    name: "SYSTEM",
    text: text.slice(0, 200),
    time: clockTime(),
    kind: "system",
  };
  room.messages.push(item);
  room.messages = room.messages.slice(-100);
  return item;
}

function withinRateLimit(socket: { data: SocketData }, key: string, limit: number, periodMs: number) {
  if (!socket.data.rateLimits) socket.data.rateLimits = new Map();
  const now = Date.now();
  const current = socket.data.rateLimits.get(key);
  if (!current || now - current.startedAt >= periodMs) {
    socket.data.rateLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count++;
  return true;
}

function ackError<T>(ack: (result: Ack<T>) => void, error: string) {
  ack({ ok: false, error });
}

async function main() {
  const skipNext = process.env.WATCH_PARTY_TEST === "true" || process.env.SKIP_NEXT === "1";
  let handle: ((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) | undefined;
  if (!skipNext) {
    const nextApp = next({ dev, hostname, port });
    await nextApp.prepare();
    handle = nextApp.getRequestHandler();
  }
  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "watch-party", activeRooms: rooms.size }));
      return;
    }
    if (handle) {
      void handle(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: true, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6,
  });

  function emitRoom(room: InternalRoom) {
    room.revision++;
    io.to(room.code).emit("room:state", snapshot(room));
  }

  function transferHostIfNeeded(room: InternalRoom) {
    const oldHost = room.hostParticipantId;
    const host = room.participants.get(oldHost);
    if (host && host.connected) return;
    const nextHost =
      Array.from(room.participants.values()).find((p) => p.connected) ??
      room.participants.values().next().value as InternalParticipant | undefined;
    if (!nextHost) return;
    if (nextHost.id === oldHost) return;
    room.hostParticipantId = nextHost.id;
    room.pauseVotes.clear();
    room.revision++;
    const msg = addSystemMessage(room, `${nextHost.name} is now the host.`);
    io.to(room.code).emit("chat:message", msg);
  }

  function removeParticipant(room: InternalRoom, clientId: string, expectedSocketId?: string) {
    const participant = room.participants.get(clientId);
    if (!participant) return;
    if (expectedSocketId && participant.socketId && participant.socketId !== expectedSocketId) return;
    if (participant.disconnectTimer) clearTimeout(participant.disconnectTimer);
    room.participants.delete(clientId);
    room.pauseVotes.delete(clientId);
    for (const poll of room.polls) delete poll.votes[clientId];
    if (room.hostParticipantId === clientId) transferHostIfNeeded(room);
    if (room.participants.size === 0) {
      rooms.delete(room.code);
      return;
    }
    const leftMessage = addSystemMessage(room, `${participant.name} left the room.`);
    io.to(room.code).emit("chat:message", leftMessage);
    emitRoom(room);
  }

  function leaveSocketRoom(socket: { id: string; data: SocketData; leave: (room: string) => unknown }) {
    const oldCode = socket.data.roomCode;
    const clientId = socket.data.clientId;
    if (!oldCode || !clientId) return;
    const oldRoom = rooms.get(oldCode);
    if (oldRoom) removeParticipant(oldRoom, clientId, socket.id);
    void socket.leave(oldCode);
    socket.data.roomCode = undefined;
  }

  io.on("connection", (socket) => {
    socket.on("clock:ping", (payload) => {
      if (!withinRateLimit(socket, "clock-ping", 10, 5_000)) return;
      const clientSentAt = Number(payload?.clientSentAt);
      if (!Number.isFinite(clientSentAt)) return;
      socket.emit("clock:pong", { clientSentAt, serverNow: Date.now() });
    });

    socket.on("room:create", (payload, ack) => {
      if (!withinRateLimit(socket, "create", 8, 60_000)) {
        ackError(ack, "Too many room creation attempts. Wait a minute and try again.");
        return;
      }
      const clientId = String(payload?.clientId || "");
      const name = normalizeDisplayName(payload?.name, "Host");
      if (clientId.length < 8 || clientId.length > 100) {
        ackError(ack, "The browser session ID is invalid. Refresh the page and try again.");
        return;
      }
      if (socket.data.roomCode) leaveSocketRoom(socket);

      let code = makeCode();
      while (rooms.has(code)) code = makeCode();

      const room: InternalRoom = {
        code,
        hostParticipantId: clientId,
        movieTitle: String(payload?.movieTitle || "Choose a movie").trim().slice(0, 120) || "Choose a movie",
        mediaUrl: "",
        isPlaying: false,
        anchorPosition: 0,
        updatedAt: Date.now(),
        revision: 1,
        createdAt: Date.now(),
        participants: new Map(),
        messages: [],
        pauseVotes: new Set(),
        playlist: [],
        polls: [],
      };
      room.participants.set(clientId, {
        id: clientId,
        name,
        isHost: true,
        connected: true,
        socketId: socket.id,
      });
      rooms.set(code, room);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.join(code);
      ack({ ok: true, room: snapshot(room) });
      emitRoom(room);
      console.log(`[room:create] ${code} host=${name}`);
    });

    socket.on("room:join", (payload, ack) => {
      if (!withinRateLimit(socket, "join", 30, 60_000)) {
        ackError(ack, "Too many attempts. Wait a moment before trying again.");
        return;
      }
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const name = normalizeDisplayName(payload?.name, "Guest");
      if (!isValidRoomCode(code)) {
        ackError(ack, "Enter a valid six-character room code.");
        return;
      }
      if (clientId.length < 8 || clientId.length > 100) {
        ackError(ack, "The browser session ID is invalid. Refresh and try again.");
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        ackError(ack, "Room not found. Ask the host to create a room first, then use the latest code.");
        return;
      }
      // A socket represents one participant. Moving to a different room leaves
      // the previous membership; an identity change inside the same room is
      // reconciled in place so a blocked-storage fallback cannot accidentally
      // remove the host and delete a one-person room.
      if (socket.data.roomCode && socket.data.roomCode !== code) leaveSocketRoom(socket);
      if (socket.data.roomCode === code && socket.data.clientId && socket.data.clientId !== clientId) {
        const previousId = socket.data.clientId;
        const previous = room.participants.get(previousId);
        const targetAlreadyExists = room.participants.has(clientId);
        if (previous && previous.socketId === socket.id && !targetAlreadyExists) {
          room.participants.delete(previousId);
          previous.id = clientId;
          previous.isHost = room.hostParticipantId === previousId;
          if (room.hostParticipantId === previousId) room.hostParticipantId = clientId;
          room.participants.set(clientId, previous);
        } else if (previous && previous.socketId === socket.id && targetAlreadyExists) {
          ackError(ack, "This browser session already has another membership in the room. Refresh the page and retry.");
          return;
        }
      }

      const existing = room.participants.get(clientId);
      if (room.participants.size >= MAX_ROOM_SIZE && !existing) {
        ackError(ack, `This prototype supports up to ${MAX_ROOM_SIZE} participants per room.`);
        return;
      }

      if (existing?.disconnectTimer) clearTimeout(existing.disconnectTimer);
      if (existing?.socketId && existing.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existing.socketId);
        oldSocket?.leave(code);
      }

      const participant: InternalParticipant = existing ?? {
        id: clientId,
        name,
        isHost: clientId === room.hostParticipantId,
        connected: true,
      };
      participant.name = name;
      participant.connected = true;
      participant.socketId = socket.id;
      participant.disconnectTimer = undefined;
      room.participants.set(clientId, participant);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.join(code);

      // If the host disconnected while nobody else was connected, this new
      // arrival becomes host instead of leaving the room with an offline host.
      transferHostIfNeeded(room);

      ack({ ok: true, room: snapshot(room) });
      if (!existing) {
        const msg = addSystemMessage(room, `${name} joined the room.`);
        io.to(code).emit("chat:message", msg);
      }
      emitRoom(room);
    });

    socket.on("room:leave", (payload) => {
      const code = String(payload?.code || "").toUpperCase();
      const clientId = String(payload?.clientId || "");
      if (socket.data.roomCode !== code || socket.data.clientId !== clientId) return;
      leaveSocketRoom(socket);
    });

    socket.on("room:movie", (payload) => {
      const code = String(payload?.code || "").toUpperCase();
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const title = String(payload?.movieTitle || "").trim().slice(0, 120);
      const participant = room?.participants.get(clientId);
      if (
        !room ||
        !title ||
        room.hostParticipantId !== clientId ||
        !participant?.connected ||
        participant.socketId !== socket.id
      ) return;
      room.movieTitle = title;
      room.anchorPosition = 0;
      room.isPlaying = false;
      room.pauseVotes.clear();
      room.updatedAt = Date.now();
      emitRoom(room);
      console.log(`[room:movie] ${code} -> ${title}`);
    });

    socket.on("room:media", (payload, ack) => {
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      if (!room || room.hostParticipantId !== clientId) {
        ackError(ack, "Only the current host can change the shared video source.");
        return;
      }
      const participant = room.participants.get(clientId);
      if (!participant?.connected || participant.socketId !== socket.id) {
        ackError(ack, "Your room connection is no longer active. Rejoin and try again.");
        return;
      }
      const mediaUrl = normalizeMediaUrl(payload?.mediaUrl);
      if (mediaUrl === null) {
        ackError(ack, "Enter a valid YouTube link or direct HTTP(S) video URL, or leave the field empty to clear it.");
        return;
      }

      room.mediaUrl = mediaUrl;
      room.anchorPosition = 0;
      room.isPlaying = false;
      room.pauseVotes.clear();
      room.updatedAt = Date.now();
      emitRoom(room);
      ack({ ok: true, room: snapshot(room) });
      console.log(`[room:media] ${code} source=${mediaUrl ? "set" : "cleared"}`);
    });

    socket.on("playback:control", (payload) => {
      const code = String(payload?.code || "").toUpperCase();
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      if (!room || room.hostParticipantId !== clientId) return;
      const participant = room.participants.get(clientId);
      if (!participant?.connected || participant.socketId !== socket.id) return;
      const action = payload.action;
      if (action !== "play" && action !== "pause" && action !== "seek" && action !== "skip" && action !== "restart" && action !== "sync") return;

      if (action === "sync") {
        // Native host controls are supported, but the server remains authoritative.
        const requested = clampPosition(payload.position);
        if (requested === null || typeof payload.isPlaying !== "boolean") return;
        room.anchorPosition = requested;
        room.isPlaying = payload.isPlaying;
      } else if (action === "restart") {
        if (!room.mediaUrl) return;
        room.anchorPosition = 0;
        room.isPlaying = true;
      } else {
        const position = currentPosition(room);
        if (action === "seek") {
          const requested = clampPosition(payload.position);
          if (requested === null) return;
          room.anchorPosition = requested;
        } else if (action === "skip") {
          const delta = Number(payload.delta);
          if (!Number.isFinite(delta) || Math.abs(delta) > 60) return;
          const duration = Number(payload.duration);
          // A forward skip that would land at/after the end is ignored. Seeking to
          // the end fires ENDED in YouTube and used to trigger a broken 1-second loop.
          if (delta > 0 && (!Number.isFinite(duration) || duration <= 0 || position + delta >= duration - 0.35)) return;
          const requested = clampPosition(position + delta);
          if (requested === null) return;
          room.anchorPosition = requested;
        } else {
          const requested = clampPosition(payload.position);
          room.anchorPosition = requested !== null ? requested : position;
          room.isPlaying = action === "play";
        }
      }
      room.pauseVotes.clear();
      room.updatedAt = Date.now();
      room.revision++;
      io.to(code).emit("playback:state", {
        code,
        isPlaying: room.isPlaying,
        position: room.anchorPosition,
        serverNow: room.updatedAt,
        revision: room.revision,
      });
      emitRoom(room);
    });

    socket.on("chat:send", (payload) => {
      if (!withinRateLimit(socket, "chat", 8, 5_000)) return;
      const code = String(payload?.code || "").toUpperCase();
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      const text = String(payload?.text || "").trim().slice(0, MAX_CHAT_LENGTH);
      if (!room || !participant?.connected || participant.socketId !== socket.id || !text) return;
      const message: ChatMessage = {
        id: randomUUID(),
        name: participant.name,
        text,
        time: clockTime(),
        kind: "user",
      };
      room.messages.push(message);
      room.messages = room.messages.slice(-100);
      io.to(code).emit("chat:message", message);
    });

    socket.on("reaction:send", (payload) => {
      if (!withinRateLimit(socket, "reaction", 8, 3_000)) return;
      const code = String(payload?.code || "").toUpperCase();
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      const emoji = String(payload?.emoji || "");
      const allowed = ["❤️", "😂", "🔥", "👏", "😮", "🍿"];
      if (!room || !participant?.connected || participant.socketId !== socket.id || !allowed.includes(emoji)) return;
      io.to(code).emit("reaction:new", { emoji, name: participant.name, id: randomUUID() });
    });

    socket.on("pause-vote:toggle", (payload) => {
      const code = String(payload?.code || "").toUpperCase();
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      if (!room || !participant?.connected || participant.socketId !== socket.id || !room.isPlaying) return;
      // Pause requests are a member feature; the host controls playback directly.
      if (clientId === room.hostParticipantId) return;

      if (room.pauseVotes.has(clientId)) room.pauseVotes.delete(clientId);
      else room.pauseVotes.add(clientId);

      const threshold = pauseVoteThreshold(room);
      if (room.pauseVotes.size >= threshold) {
        room.anchorPosition = currentPosition(room);
        room.isPlaying = false;
        room.updatedAt = Date.now();
        room.revision++;
        room.pauseVotes.clear();
        io.to(code).emit("playback:state", {
          code,
          isPlaying: false,
          position: room.anchorPosition,
          serverNow: room.updatedAt,
          revision: room.revision,
        });
      }
      emitRoom(room);
      io.to(code).emit("pause-vote:state", {
        code,
        participantIds: Array.from(room.pauseVotes),
        threshold: pauseVoteThreshold(room),
      });
    });

    socket.on("playlist:add", (payload) => {
      if (!withinRateLimit(socket, "playlist-add", 10, 60_000)) return;
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      if (!room || !participant?.connected || participant.socketId !== socket.id) return;
      if (room.playlist.length >= 30) return;
      const title = String(payload?.title || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 100);
      const mediaUrl = normalizeMediaUrl(payload?.mediaUrl);
      if (!title || !mediaUrl || !mediaUrl.trim()) return;
      if (room.playlist.some((item) => item.mediaUrl === mediaUrl)) return;
      room.playlist.push({ id: randomUUID(), title, mediaUrl, addedBy: clientId, addedByName: participant.name, createdAt: Date.now() });
      const msg = addSystemMessage(room, `${participant.name} added “${title}” to the shared playlist.`);
      emitRoom(room);
      io.to(code).emit("chat:message", msg);
    });

    socket.on("playlist:remove", (payload) => {
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      const itemId = String(payload?.itemId || "");
      if (!room || !participant?.connected || participant.socketId !== socket.id) return;
      const item = room.playlist.find((candidate) => candidate.id === itemId);
      if (!item || (room.hostParticipantId !== clientId && item.addedBy !== clientId)) return;
      room.playlist = room.playlist.filter((candidate) => candidate.id !== itemId);
      emitRoom(room);
    });

    socket.on("playlist:play", (payload) => {
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      if (!room || room.hostParticipantId !== clientId || !participant?.connected || participant.socketId !== socket.id) return;
      const item = room.playlist.find((candidate) => candidate.id === String(payload?.itemId || ""));
      if (!item) return;
      room.mediaUrl = item.mediaUrl;
      room.movieTitle = item.title;
      room.anchorPosition = 0;
      room.isPlaying = false;
      room.updatedAt = Date.now();
      room.pauseVotes.clear();
      room.revision++;
      io.to(code).emit("playback:state", { code, isPlaying: false, position: 0, serverNow: room.updatedAt, revision: room.revision });
      emitRoom(room);
    });

    socket.on("poll:create", (payload) => {
      if (!withinRateLimit(socket, "poll-create", 5, 60_000)) return;
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      if (!room || !participant?.connected || participant.socketId !== socket.id || room.polls.length >= 10) return;
      const question = String(payload?.question || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 160);
      const rawOptions = Array.isArray(payload?.options) ? payload.options : [];
      const options = rawOptions.map((option) => String(option || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 80)).filter(Boolean);
      const uniqueOptions = Array.from(new Set(options));
      if (!question || uniqueOptions.length < 2 || uniqueOptions.length > 6) return;
      room.polls.unshift({ id: randomUUID(), question, options: uniqueOptions, votes: {}, createdBy: clientId, createdByName: participant.name, createdAt: Date.now(), isOpen: true });
      room.polls = room.polls.slice(0, 10);
      const msg = addSystemMessage(room, `${participant.name} started a poll: ${question}`);
      emitRoom(room);
      io.to(code).emit("chat:message", msg);
    });

    socket.on("poll:vote", (payload) => {
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      const poll = room?.polls.find((candidate) => candidate.id === String(payload?.pollId || ""));
      const optionIndex = Number(payload?.optionIndex);
      if (!room || !participant?.connected || participant.socketId !== socket.id || !poll?.isOpen) return;
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) return;
      poll.votes[clientId] = optionIndex; // Changing one's choice replaces their previous vote.
      emitRoom(room);
    });

    socket.on("poll:close", (payload) => {
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      const poll = room?.polls.find((candidate) => candidate.id === String(payload?.pollId || ""));
      if (!room || !participant?.connected || participant.socketId !== socket.id || !poll?.isOpen) return;
      if (room.hostParticipantId !== clientId && poll.createdBy !== clientId) return;
      poll.isOpen = false;
      emitRoom(room);
    });

    socket.on("room:host-transfer", (payload, ack) => {
      const code = normalizeRoomCode(payload?.code);
      const clientId = String(payload?.clientId || "");
      const targetId = String(payload?.targetParticipantId || "");
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      const target = room?.participants.get(targetId);
      if (!room || room.hostParticipantId !== clientId || !participant?.connected || participant.socketId !== socket.id) {
        if (typeof ack === "function") ackError(ack, "Only the current host can transfer host privileges.");
        return;
      }
      if (!target || !target.connected || target.id === clientId) {
        if (typeof ack === "function") ackError(ack, "Choose another participant who is currently connected.");
        return;
      }
      room.hostParticipantId = targetId;
      room.pauseVotes.clear();
      room.revision++;
      const msg = addSystemMessage(room, `${target.name} is now the host.`);
      io.to(code).emit("chat:message", msg);
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, room: snapshot(room) });
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode;
      const clientId = socket.data.clientId;
      if (!code || !clientId) return;
      const room = rooms.get(code);
      const participant = room?.participants.get(clientId);
      if (!room || !participant || participant.socketId !== socket.id) return;
      participant.connected = false;
      participant.socketId = undefined;
      room.pauseVotes.delete(clientId);
      // Promote a connected member immediately so a disconnected host does not
      // leave the room unable to control playback during the reconnect grace period.
      if (room.hostParticipantId === clientId) transferHostIfNeeded(room);
      participant.disconnectTimer = setTimeout(() => {
        const latestRoom = rooms.get(code);
        const latestParticipant = latestRoom?.participants.get(clientId);
        if (!latestRoom || !latestParticipant || latestParticipant.connected) return;
        removeParticipant(latestRoom, clientId);
      }, DISCONNECT_GRACE_MS);
      participant.disconnectTimer.unref?.();
      emitRoom(room);
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Watch Party ready at http://${hostname}:${port}`);
    console.log("> Socket.IO backend enabled (in-memory development storage)");
    console.log(`> Health check: http://${hostname}:${port}/healthz`);
  });
}

main().catch((error: unknown) => {
  console.error("Failed to start Watch Party server:", error);
  process.exit(1);
});

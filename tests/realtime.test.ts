import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { io, type Socket } from "socket.io-client";
import type {
  Ack,
  ClientToServerEvents,
  RoomSnapshot,
  ServerToClientEvents,
} from "../lib/protocol";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function getFreePort(): Promise<number> {
  const server = createNetServer();

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a test port.");
  }

  const port = address.port;

  await new Promise<void>((resolveClose, reject) => {
    server.close((error) =>
      error ? reject(error) : resolveClose(),
    );
  });

  return port;
}

const delay = (ms: number) =>
  new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForHealth(
  url: string,
  child: ChildProcessWithoutNullStreams,
  readLogs: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "server has not responded";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Watch Party server exited before health check. ${readLogs()}`,
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1500),
      });

      if (response.ok) {
        const json = (await response.json()) as {
          ok?: boolean;
          service?: string;
        };

        if (json.ok && json.service === "watch-party") {
          return;
        }
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(500);
  }

  throw new Error(
    `Watch Party server health check timed out (${lastError}). ${readLogs()}`,
  );
}

function connect(socket: TestSocket): Promise<void> {
  return new Promise((resolveConnect, reject) => {
    const onConnectError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("connect_error", onConnectError);
    };

    socket.once("connect", () => {
      cleanup();
      resolveConnect();
    });

    socket.once("connect_error", onConnectError);
    socket.connect();
  });
}

function withAck<T>(
  socket: TestSocket,
  emit: (
    callback: (error: Error | null, response: Ack<T> | undefined) => void,
  ) => void,
): Promise<Ack<T>> {
  return new Promise((resolveAck, reject) => {
    emit((error, response) => {
      if (error) {
        reject(error);
      } else if (!response) {
        reject(new Error("Socket event returned no acknowledgement."));
      } else {
        resolveAck(response);
      }
    });
  });
}

function waitForEvent<T>(
  socket: TestSocket,
  event: "room:state" | "playback:state" | "chat:message",
  predicate: (payload: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolveEvent, reject) => {
    const listener = (payload: T) => {
      if (!predicate(payload)) return;

      clearTimeout(timeout);
      socket.off(event, listener as never);
      resolveEvent(payload);
    };

    const timeout = setTimeout(() => {
      socket.off(event, listener as never);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);

    socket.on(event, listener as never);
  });
}

function waitForEvents<T>(
  socket: TestSocket,
  event: "room:state" | "playback:state" | "chat:message",
  predicate: (payload: T) => boolean,
  count: number,
  timeoutMs = 5000,
): Promise<T[]> {
  return new Promise((resolveEvents, rejectEvents) => {
    const matches: T[] = [];

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(event, listener as never);
    };

    const listener = (payload: T) => {
      if (!predicate(payload)) return;

      matches.push(payload);

      if (matches.length >= count) {
        cleanup();
        resolveEvents(matches);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      rejectEvents(
        new Error(
          `Timed out waiting for ${count} ${event} events; received ${matches.length}.`,
        ),
      );
    }, timeoutMs);

    socket.on(event, listener as never);
  });
}

test(
  "real-time server keeps the host and joining participant in shared room state",
  { timeout: 90_000 },
  async () => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");

    let logs = "";

    const child = spawn(process.execPath, [tsxCli, "server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        NODE_ENV: "development",
        WATCH_PARTY_TEST: "true",
      },
      stdio: "pipe",
    });

    child.stdout.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });

    let host: TestSocket | undefined;
    let guest: TestSocket | undefined;
    let lateHost: TestSocket | undefined;
    let lateGuest: TestSocket | undefined;
    const additionalSockets: TestSocket[] = [];

    try {
      await waitForHealth(`${baseUrl}/healthz`, child, () => logs);

      host = io(baseUrl, {
        autoConnect: false,
        reconnection: false,
        transports: ["websocket"],
      }) as TestSocket;

      guest = io(baseUrl, {
        autoConnect: false,
        reconnection: false,
        transports: ["websocket"],
      }) as TestSocket;

      await Promise.all([connect(host), connect(guest)]);

      const clientSentAt = Date.now();
      const clockPongPromise = new Promise<{ clientSentAt: number; serverNow: number }>((resolvePong) => {
        host!.once("clock:pong", resolvePong);
      });
      host.emit("clock:ping", { clientSentAt });
      const clockPong = await clockPongPromise;
      assert.equal(clockPong.clientSentAt, clientSentAt);
      assert.ok(Math.abs(clockPong.serverNow - Date.now()) < 1000, "server clock ping should return a current timestamp");

      const created = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) =>
          host!.timeout(8000).emit(
            "room:create",
            {
              clientId: "host-session-id-1234",
              name: "Host Tester",
              movieTitle: "Choose a movie",
            },
            ack,
          ),
      );

      assert.equal(created.ok, true);

      const code = created.room.code;

      assert.equal(created.room.participants.length, 1);
      assert.deepEqual(created.room.playlist, []);
      assert.deepEqual(created.room.polls, []);

      const hostStatePromise = waitForEvent<RoomSnapshot>(
        host,
        "room:state",
        (state) => state.code === code && state.participants.length === 2,
      );

      const joined = await withAck<{ room: RoomSnapshot }>(
        guest,
        (ack) =>
          guest!.timeout(8000).emit(
            "room:join",
            {
              code,
              clientId: "guest-session-id-5678",
              name: "Guest Tester",
            },
            ack,
          ),
      );

      assert.equal(joined.ok, true);

      const ids = joined.room.participants.map((person) => person.id);

      assert.equal(joined.room.participants.length, 2);
      assert.ok(ids.includes("host-session-id-1234"));
      assert.ok(ids.includes("guest-session-id-5678"));

      assert.equal(
        joined.room.participants.find(
          (person) => person.id === "host-session-id-1234",
        )?.isHost,
        true,
      );

      const hostUpdatedState = await hostStatePromise;

      assert.equal(hostUpdatedState.participants.length, 2);

      const chatPromise = waitForEvent<{
        id: string;
        name: string;
        text: string;
        time: string;
      }>(
        guest,
        "chat:message",
        (item) =>
          item.name === "Guest Tester" &&
          item.text === "Integration test message",
      );

      guest.emit("chat:send", {
        code,
        clientId: "guest-session-id-5678",
        text: "Integration test message",
      });

      const chat = await chatPromise;

      assert.equal(chat.text, "Integration test message");

      const playbackPromise = waitForEvent<{
        code: string;
        isPlaying: boolean;
        position: number;
        revision: number;
      }>(
        guest,
        "playback:state",
        (state) => state.code === code && state.isPlaying,
      );

      host.emit("playback:control", {
        code,
        clientId: "host-session-id-1234",
        action: "play",
      });

      const playback = await playbackPromise;

      assert.equal(playback.isPlaying, true);

      // Two rapid relative skips must accumulate against the authoritative server
      // position. A client that sends stale absolute targets can otherwise lose one.
      // Wait for two playback events, not a revision delta: room:state snapshots also
      // increment the shared room revision between playback commands.
      const doubleSkipPromise = waitForEvents<{
        code: string;
        isPlaying: boolean;
        position: number;
        revision: number;
      }>(
        guest,
        "playback:state",
        (state) => state.code === code && state.revision > playback.revision,
        2,
      );

      host.emit("playback:control", {
        code,
        clientId: "host-session-id-1234",
        action: "skip",
        delta: 10,
        duration: 1000,
      });

      host.emit("playback:control", {
        code,
        clientId: "host-session-id-1234",
        action: "skip",
        delta: 10,
        duration: 1000,
      });

      const skipStates = await doubleSkipPromise;
      const doubleSkipped = skipStates[skipStates.length - 1];

      assert.equal(
        doubleSkipped.isPlaying,
        true,
        "skipping must preserve playing state",
      );

      assert.ok(
        doubleSkipped.position >= 19 && doubleSkipped.position < 22,
        `two quick +10 second skips should land near 20 seconds, got ${doubleSkipped.position}`,
      );

      // A forward skip that would reach the end must be ignored instead of
      // seeking into ENDED and triggering the old first-second loop regression.
      host.emit("playback:control", {
        code,
        clientId: "host-session-id-1234",
        action: "skip",
        delta: 10,
        duration: 21,
      });

      await delay(120);

      const afterEndSkip = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) =>
          host!.timeout(8000).emit(
            "room:join",
            { code, clientId: "host-session-id-1234", name: "Host Tester" },
            ack,
          ),
      );

      assert.equal(afterEndSkip.ok, true);

      if (afterEndSkip.ok) {
        assert.ok(
          afterEndSkip.room.position < 22,
          `overshooting skip should be ignored near the end, got ${afterEndSkip.room.position}`,
        );
        assert.equal(afterEndSkip.room.isPlaying, true);
      }

      // A guest must not be able to pause or seek the shared playback state.
      guest.emit("playback:control", {
        code,
        clientId: "guest-session-id-5678",
        action: "pause",
      });

      guest.emit("playback:control", {
        code,
        clientId: "guest-session-id-5678",
        action: "seek",
        position: 300,
      });

      guest.emit("playback:control", {
        code,
        clientId: "guest-session-id-5678",
        action: "sync",
        position: 300,
        isPlaying: false,
      });

      await delay(150);

      const afterGuestCommands = await withAck<{ room: RoomSnapshot }>(
        guest,
        (ack) =>
          guest!.timeout(8000).emit(
            "room:join",
            { code, clientId: "guest-session-id-5678", name: "Guest Tester" },
            ack,
          ),
      );

      assert.equal(afterGuestCommands.ok, true);

      if (afterGuestCommands.ok) {
        assert.equal(
          afterGuestCommands.room.isPlaying,
          true,
          "guest pause commands must be ignored",
        );

        assert.ok(
          afterGuestCommands.room.position < 100,
          "guest seek/sync commands must not jump the room to 300 seconds",
        );
      }

      // Native YouTube transport changes from the host update the authoritative room atomically.
      const nativeSyncPromise = waitForEvent<{
        code: string;
        isPlaying: boolean;
        position: number;
        revision: number;
      }>(
        guest,
        "playback:state",
        (state) =>
          state.code === code &&
          !state.isPlaying &&
          state.position >= 41.5 &&
          state.position <= 42.5,
      );

      host.emit("playback:control", {
        code,
        clientId: "host-session-id-1234",
        action: "sync",
        position: 42,
        isPlaying: false,
      });

      const nativeSynced = await nativeSyncPromise;

      assert.equal(nativeSynced.isPlaying, false);
      assert.equal(nativeSynced.position, 42);

      const media = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) =>
          host!.timeout(8000).emit(
            "room:media",
            {
              code,
              clientId: "host-session-id-1234",
              mediaUrl:
                "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
            },
            ack,
          ),
      );

      assert.equal(media.ok, true);

      assert.equal(
        media.room.mediaUrl,
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      );

      assert.equal(media.room.participants.length, 2);

      const youtube = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) =>
          host!.timeout(8000).emit(
            "room:media",
            {
              code,
              clientId: "host-session-id-1234",
              mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            },
            ack,
          ),
      );

      assert.equal(
        youtube.ok,
        true,
        "YouTube watch URLs should be accepted by the room server",
      );

      assert.equal(
        youtube.room.mediaUrl,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      const restartPromise = waitForEvent<{
        code: string;
        isPlaying: boolean;
        position: number;
        revision: number;
      }>(
        guest,
        "playback:state",
        (state) => state.code === code && state.isPlaying && state.position === 0,
      );

      host.emit("playback:control", {
        code,
        clientId: "host-session-id-1234",
        action: "restart",
      });

      const restarted = await restartPromise;

      assert.equal(
        restarted.isPlaying,
        true,
        "an end-of-video restart remains playing",
      );

      assert.equal(
        restarted.position,
        0,
        "an end-of-video restart resets the shared clock atomically",
      );

      // Host votes are ignored because the host has direct playback controls.
      // The only eligible guest can request the pause in this two-person room.
      host.emit("pause-vote:toggle", {
        code,
        clientId: "host-session-id-1234",
      });

      await delay(80);

      const votePausedPromise = waitForEvent<{
        code: string;
        isPlaying: boolean;
        position: number;
        revision: number;
      }>(
        guest,
        "playback:state",
        (state) => state.code === code && !state.isPlaying,
      );

      guest.emit("pause-vote:toggle", {
        code,
        clientId: "guest-session-id-5678",
      });

      const votePaused = await votePausedPromise;

      assert.equal(
        votePaused.isPlaying,
        false,
        "a successful pause vote pauses the shared room",
      );

      const rejected = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) =>
          host!.timeout(8000).emit(
            "room:media",
            {
              code,
              clientId: "host-session-id-1234",
              mediaUrl: "javascript:alert(1)",
            },
            ack,
          ),
      );

      assert.equal(
        rejected.ok,
        false,
        "unsafe media schemes should be rejected",
      );

      const recovered = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) =>
          host!.timeout(8000).emit(
            "room:join",
            {
              code,
              clientId: "host-session-id-recovered-999",
              name: "Host Tester",
            },
            ack,
          ),
      );

      assert.equal(recovered.ok, true);

      assert.equal(
        recovered.room.hostParticipantId,
        "host-session-id-recovered-999",
      );

      assert.equal(recovered.room.participants.length, 2);

      assert.ok(
        recovered.room.participants.some(
          (person) =>
            person.id === "host-session-id-recovered-999" && person.isHost,
        ),
      );

      assert.ok(
        recovered.room.participants.some(
          (person) => person.id === "guest-session-id-5678",
        ),
      );

      // Shared playlist: a connected member can add a safe link, then the host
      // can load that queued item into the authoritative room player.
      const playlistUpdatePromise = waitForEvent<RoomSnapshot>(
        host,
        "room:state",
        (state) => state.code === code && state.playlist?.length === 1,
      );
      guest.emit("playlist:add", {
        code,
        clientId: "guest-session-id-5678",
        title: "Shared sample clip",
        mediaUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      });
      const playlistRoom = await playlistUpdatePromise;
      assert.equal(playlistRoom.playlist[0].title, "Shared sample clip");
      const playlistLoadPromise = waitForEvent<RoomSnapshot>(
        guest,
        "room:state",
        (state) => state.code === code && state.movieTitle === "Shared sample clip" && state.mediaUrl.includes("flower.mp4"),
      );
      host.emit("playlist:play", {
        code,
        clientId: "host-session-id-recovered-999",
        itemId: playlistRoom.playlist[0].id,
      });
      const playlistLoaded = await playlistLoadPromise;
      assert.equal(playlistLoaded.isPlaying, false, "loading a playlist item should wait for explicit host Play");

      // Group polls are server-authored snapshots; votes are participant-scoped
      // and a participant can change their selection without counting twice.
      const pollCreatePromise = waitForEvent<RoomSnapshot>(
        host,
        "room:state",
        (state) => state.code === code && state.polls?.length === 1,
      );
      guest.emit("poll:create", {
        code,
        clientId: "guest-session-id-5678",
        question: "What should we watch next?",
        options: ["Interstellar", "Inception", "Dune"],
      });
      const pollRoom = await pollCreatePromise;
      const pollId = pollRoom.polls[0].id;
      const votePromise = waitForEvent<RoomSnapshot>(
        host,
        "room:state",
        (state) => state.code === code && state.polls[0]?.votes?.["guest-session-id-5678"] === 1,
      );
      guest.emit("poll:vote", { code, clientId: "guest-session-id-5678", pollId, optionIndex: 1 });
      const votedRoom = await votePromise;
      assert.equal(votedRoom.polls[0].votes["guest-session-id-5678"], 1);
      const closePollPromise = waitForEvent<RoomSnapshot>(
        guest,
        "room:state",
        (state) => state.code === code && state.polls[0]?.isOpen === false,
      );
      host.emit("poll:close", { code, clientId: "host-session-id-recovered-999", pollId });
      const closedPollRoom = await closePollPromise;
      assert.equal(closedPollRoom.polls[0].isOpen, false);

      // Load-test membership at the rubric's minimum of 10 concurrent users.
      // Eight additional sockets join the existing host + guest room.
      for (let index = 0; index < 8; index++) {
        const member = io(baseUrl, {
          autoConnect: false,
          reconnection: false,
          transports: ["websocket"],
        }) as TestSocket;
        additionalSockets.push(member);
        await connect(member);
        const memberJoin = await withAck<{ room: RoomSnapshot }>(
          member,
          (ack) => member.timeout(8000).emit(
            "room:join",
            { code, clientId: `load-member-session-${index}-1234`, name: `Load Member ${index + 1}` },
            ack,
          ),
        );
        assert.equal(memberJoin.ok, true, `load member ${index + 1} should join`);
      }
      const tenUserRoom = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) => host!.timeout(8000).emit(
          "room:join",
          { code, clientId: "host-session-id-recovered-999", name: "Host Tester" },
          ack,
        ),
      );
      assert.equal(tenUserRoom.ok, true);
      assert.equal(tenUserRoom.room.participants.length, 10, "room should support at least 10 concurrent participants");

      // Measure end-to-end local playback-control delivery to all nine remote
      // participant sockets. This is a localhost smoke benchmark, not a substitute
      // for a separate-machine LAN test required by the club rubric.
      const remoteSockets = [guest, ...additionalSockets];
      const sampleCount = 20;
      const sentAt: number[] = [];
      const latencySamples: number[] = [];
      const perSocketCounts = new Map<TestSocket, number>();
      for (const remote of remoteSockets) perSocketCounts.set(remote, 0);
      let resolveLatency!: () => void;
      let rejectLatency!: (error: Error) => void;
      const latencyComplete = new Promise<void>((resolve, reject) => {
        resolveLatency = resolve;
        rejectLatency = reject;
      });
      const listeners = new Map<TestSocket, (state: { code: string; revision: number }) => void>();
      for (const remote of remoteSockets) {
        const listener = (state: { code: string; revision: number }) => {
          if (state.code !== code) return;
          const index = perSocketCounts.get(remote) ?? 0;
          if (index >= sampleCount || sentAt[index] === undefined) return;
          latencySamples.push(performance.now() - sentAt[index]);
          perSocketCounts.set(remote, index + 1);
          if ([...perSocketCounts.values()].every((count) => count >= sampleCount)) resolveLatency();
        };
        listeners.set(remote, listener);
        remote.on("playback:state", listener as never);
      }
      const latencyTimer = setTimeout(() => rejectLatency(new Error("Playback latency smoke test timed out before every participant received every control.")), 10_000);
      for (let index = 0; index < sampleCount; index++) {
        sentAt.push(performance.now());
        host.emit("playback:control", {
          code,
          clientId: "host-session-id-recovered-999",
          action: index % 2 === 0 ? "play" : "pause",
        });
      }
      try {
        await latencyComplete;
      } finally {
        if (latencyTimer) clearTimeout(latencyTimer);
        for (const [remote, listener] of listeners) remote.off("playback:state", listener as never);
      }
      const sortedLatency = [...latencySamples].sort((a, b) => a - b);
      const p95Index = Math.min(sortedLatency.length - 1, Math.ceil(sortedLatency.length * 0.95) - 1);
      const p95Latency = sortedLatency[p95Index];
      console.log(`[performance-smoke] users=10 samples=${latencySamples.length} playback-control-p95=${p95Latency.toFixed(2)}ms`);
      assert.ok(p95Latency <= 250, `localhost playback control p95 must be <= 250ms; measured ${p95Latency.toFixed(2)}ms`);

      // Manual host handover succeeds for a connected participant; the old host
      // cannot immediately transfer the role again after losing host privileges.
      const transfer = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) => host!.timeout(8000).emit(
          "room:host-transfer",
          { code, clientId: "host-session-id-recovered-999", targetParticipantId: "guest-session-id-5678" },
          ack,
        ),
      );
      assert.equal(transfer.ok, true);
      if (transfer.ok) assert.equal(transfer.room.hostParticipantId, "guest-session-id-5678");
      const forbiddenTransfer = await withAck<{ room: RoomSnapshot }>(
        host,
        (ack) => host!.timeout(8000).emit(
          "room:host-transfer",
          { code, clientId: "host-session-id-recovered-999", targetParticipantId: "guest-session-id-5678" },
          ack,
        ),
      );
      assert.equal(forbiddenTransfer.ok, false, "a former host cannot transfer host privileges");

      // If the active host disconnects, a connected participant is promoted
      // immediately rather than after the 30-second reconnect grace interval.
      const automaticTransferPromise = waitForEvent<RoomSnapshot>(
        host,
        "room:state",
        (state) => state.code === code && state.hostParticipantId === "host-session-id-recovered-999",
      );
      guest.disconnect();
      const automaticTransfer = await automaticTransferPromise;
      assert.equal(automaticTransfer.hostParticipantId, "host-session-id-recovered-999");

      // Regression: if the host disconnects while every other participant is
      // already offline, a member who rejoins during the grace window should
      // become host rather than entering a room controlled by an offline user.
      lateHost = io(baseUrl, { autoConnect: false, reconnection: false, transports: ["websocket"] }) as TestSocket;
      lateGuest = io(baseUrl, { autoConnect: false, reconnection: false, transports: ["websocket"] }) as TestSocket;
      await Promise.all([connect(lateHost), connect(lateGuest)]);
      const lateCreated = await withAck<{ room: RoomSnapshot }>(
        lateHost,
        (ack) => lateHost!.timeout(8000).emit("room:create", {
          clientId: "late-host-session-1234",
          name: "Late Host",
          movieTitle: "Reconnect test",
        }, ack),
      );
      assert.equal(lateCreated.ok, true);
      const lateCode = lateCreated.room.code;
      const lateJoined = await withAck<{ room: RoomSnapshot }>(
        lateGuest,
        (ack) => lateGuest!.timeout(8000).emit("room:join", {
          code: lateCode,
          clientId: "late-guest-session-5678",
          name: "Late Guest",
        }, ack),
      );
      assert.equal(lateJoined.ok, true);
      lateGuest.disconnect();
      await delay(80);
      lateHost.disconnect();
      await delay(80);
      await connect(lateGuest);
      const lateRejoined = await withAck<{ room: RoomSnapshot }>(
        lateGuest,
        (ack) => lateGuest!.timeout(8000).emit("room:join", {
          code: lateCode,
          clientId: "late-guest-session-5678",
          name: "Late Guest",
        }, ack),
      );
      assert.equal(lateRejoined.ok, true);
      if (lateRejoined.ok) {
        assert.equal(lateRejoined.room.hostParticipantId, "late-guest-session-5678");
      }
      assert.ok(lateGuest);

      // Regression: Host authoritative playback startup with position
      // Host sends playback:control with action: "play" and position: 42.5.
      // Guest receives playback:state with isPlaying: true and position: 42.5.
      const authoritativePlaybackPromise = waitForEvent<{
        code: string;
        isPlaying: boolean;
        position: number;
        revision: number;
      }>(
        lateGuest,
        "playback:state",
        (state) => state.code === lateCode && state.isPlaying && state.position === 42.5,
      );

      lateGuest.emit("playback:control", {
        code: lateCode,
        clientId: "late-guest-session-5678",
        action: "play",
        position: 42.5,
      });

      const authoritativePlayback = await authoritativePlaybackPromise;
      assert.equal(authoritativePlayback.isPlaying, true);
      assert.equal(authoritativePlayback.position, 42.5);

      // Regression: Late joiner receives current authoritative running playback state
      const unauthorizedGuest = io(baseUrl, { autoConnect: false, reconnection: false, transports: ["websocket"] }) as TestSocket;
      additionalSockets.push(unauthorizedGuest);
      await connect(unauthorizedGuest);

      const unauthJoin = await withAck<{ room: RoomSnapshot }>(
        unauthorizedGuest,
        (ack) => unauthorizedGuest.timeout(8000).emit("room:join", {
          code: lateCode,
          clientId: "unauth-guest-session-9999",
          name: "Unauth Guest",
        }, ack),
      );
      assert.equal(unauthJoin.ok, true);
      if (unauthJoin.ok) {
        assert.equal(unauthJoin.room.isPlaying, true);
        assert.ok(unauthJoin.room.position >= 42.5, "late joiner receives advanced running playback position");
      }

      // Regression: Unauthorized guest attempts to pause or seek with stale position
      unauthorizedGuest.emit("playback:control", {
        code: lateCode,
        clientId: "unauth-guest-session-9999",
        action: "pause",
        position: 0,
      });
      unauthorizedGuest.emit("playback:control", {
        code: lateCode,
        clientId: "unauth-guest-session-9999",
        action: "seek",
        position: 0,
      });

      await delay(100);

      // Verify the room position was not overwritten or paused by guest:
      const checkRoomState = await withAck<{ room: RoomSnapshot }>(
        lateGuest,
        (ack) => lateGuest!.timeout(8000).emit("room:join", {
          code: lateCode,
          clientId: "late-guest-session-5678",
          name: "Late Guest",
        }, ack),
      );
      assert.equal(checkRoomState.ok, true);
      if (checkRoomState.ok) {
        assert.equal(checkRoomState.room.isPlaying, true);
        assert.ok(checkRoomState.room.position >= 42.5, "stale guest playback control must not overwrite running playback position");
      }
    } finally {
      host?.disconnect();
      guest?.disconnect();
      lateHost?.disconnect();
      lateGuest?.disconnect();
      for (const member of additionalSockets) member.disconnect();
      child.kill();

      await Promise.race([
        new Promise<void>((resolveExit) =>
          child.once("exit", () => resolveExit()),
        ),
        delay(2000),
      ]);
    }
  },
);
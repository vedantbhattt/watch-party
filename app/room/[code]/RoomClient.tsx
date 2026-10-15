"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getClientId, getSocket } from "../../../lib/socket";
import { getYouTubeVideoId, normalizeMediaUrl } from "../../../lib/validation";
import type { Ack, ChatMessage, GroupPoll, PlaybackSnapshot, PlaylistItem, RoomSnapshot } from "../../../lib/protocol";

const movieOptions = [
  "Choose a movie",
  "Interstellar",
  "Inception",
  "Spider-Man: Across the Spider-Verse",
  "The Batman",
  "Dune: Part Two",
  "Oppenheimer",
  "The Martian",
  "The Grand Budapest Hotel",
];
const emojis = ["❤️", "😂", "🔥", "👏", "😮", "🍿"];
const SAMPLE_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

type Reaction = { emoji: string; name: string; id: string };

type YouTubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};

type YouTubeEvent = { data: number; target: YouTubePlayer };

function isYouTubePlayer(value: unknown): value is YouTubePlayer {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const player = value as Partial<YouTubePlayer>;
  return typeof player.getCurrentTime === "function" &&
    typeof player.getDuration === "function" &&
    typeof player.getPlayerState === "function" &&
    typeof player.seekTo === "function" &&
    typeof player.playVideo === "function" &&
    typeof player.pauseVideo === "function" &&
    typeof player.getIframe === "function" &&
    typeof player.destroy === "function";
}

function safeGetCurrentTime(player: unknown): number | null {
  if (!isYouTubePlayer(player)) return null;
  try {
    const time = player.getCurrentTime();
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

function safeGetDuration(player: unknown): number | null {
  if (!isYouTubePlayer(player)) return null;
  try {
    const duration = player.getDuration();
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

function safeGetPlayerState(player: unknown): number | null {
  if (!isYouTubePlayer(player)) return null;
  try {
    const state = player.getPlayerState();
    return typeof state === "number" ? state : null;
  } catch {
    return null;
  }
}

type YouTubeNamespace = {
  PlayerState: { UNSTARTED: number; ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
  Player: new (element: HTMLElement, options: {
    videoId: string;
    playerVars?: Record<string, string | number>;
    events: {
      onReady: (event: YouTubeEvent) => void;
      onStateChange: (event: YouTubeEvent) => void;
      onError: (event: YouTubeEvent) => void;
    };
  }) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      youtubeApiPromise = null;
      reject(new Error("Timed out loading the YouTube player API."));
    }, 15_000);

    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else {
        youtubeApiPromise = null;
        reject(new Error("The YouTube player API did not initialize."));
      }
    };

    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        script?.remove();
        youtubeApiPromise = null;
        reject(new Error("Could not load the YouTube player API. Check your internet connection."));
      };
      document.head.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

function explainYouTubeError(code: number) {
  if (code === 2) return "This YouTube link has an invalid video ID. Check the URL and try again.";
  if (code === 5) return "This video can't be played by the embedded YouTube player in this browser.";
  if (code === 100) return "This YouTube video is unavailable, private, or has been removed.";
  if (code === 101 || code === 150) return "The owner has disabled embedded playback for this YouTube video. Try another video or use a direct video file you can share.";
  if (code === 153) return "YouTube could not verify the embed request. Try refreshing the room or using a direct video URL.";
  return "YouTube could not play this video. Check that it is available and allows embedding.";
}

function explainDirectVideoError(code: number | undefined) {
  if (code === 2) return "The video network request failed. Check the URL, internet connection, and whether the source allows access from your browser.";
  if (code === 3) return "The browser received the video but couldn't decode it. Try a standard MP4 (H.264/AAC) or WebM source.";
  if (code === 4) return "This URL isn't a browser-playable video file. Use a direct MP4/WebM URL or a supported YouTube link—not a webpage or streaming-service page.";
  return "The video was interrupted before it loaded. Try sharing the source again.";
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...previous, ...incoming]) byId.set(message.id, message);
  return Array.from(byId.values()).slice(-100);
}

function readDisplayName() {
  try { return sessionStorage.getItem("watch-party-name")?.trim().slice(0, 24) || "Guest"; }
  catch { return "Guest"; }
}

export default function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const youtubeMountRef = useRef<HTMLDivElement | null>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const reactionTimersRef = useRef<Map<string, number>>(new Map());
  const lastMediaUrlRef = useRef<string | null>(null);
  const endLoopInProgressRef = useRef(false);
  const roomDrivenYouTubeSeekRef = useRef<{ target: number; expiresAt: number } | null>(null);
  const lastObservedYouTubeTimeRef = useRef<number | null>(null);
  const programmaticYouTubePlaybackUntilRef = useRef(0);
  const serverClockOffsetRef = useRef<number | null>(null);
  const hostPendingPlayRef = useRef(false);
  const hostPlayTimeoutRef = useRef<number | null>(null);
  const [hostStartingPlayback, setHostStartingPlayback] = useState(false);
  const [clientId] = useState(() => getClientId());
  const [displayName] = useState(() => readDisplayName());
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(true);
  const [connected, setConnected] = useState(false);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [videoError, setVideoError] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [youtubeReadyFor, setYoutubeReadyFor] = useState("");
  const [videoRetryKey, setVideoRetryKey] = useState(0);
  const [selectedMovie, setSelectedMovie] = useState("Choose a movie");
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [copyStatus, setCopyStatus] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [chatFilter, setChatFilter] = useState("");
  const [playlistTitle, setPlaylistTitle] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptionsInput, setPollOptionsInput] = useState("Yes,No");
  const [roomActionStatus, setRoomActionStatus] = useState("");
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isHost = Boolean(room && clientId && room.hostParticipantId === clientId);
  // YouTube's IFrame API callbacks are created when the video first loads and can
  // otherwise retain stale React state (for example, isPlaying=false from load time).
  const roomRef = useRef<RoomSnapshot | null>(room);
  roomRef.current = room;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const youtubeVideoId = getYouTubeVideoId(room?.mediaUrl || "");
  const youtubePlayerKey = `${youtubeVideoId || ""}:${videoRetryKey}:${isHost ? "host" : "guest"}`;
  const youtubeReady = Boolean(youtubeVideoId && youtubeReadyFor === youtubePlayerKey);
  const isPlayerReady = youtubeVideoId ? youtubeReady : true;
  const publishNativeYouTubeState = useCallback((position: number, playing: boolean) => {
    const latestRoom = roomRef.current;
    const socket = socketRef.current;
    if (!isHostRef.current || !latestRoom || !socket?.connected || !Number.isFinite(position)) return;
    const safePos = Math.max(0, position);
    lastObservedYouTubeTimeRef.current = safePos;
    // Treat the host's observed timestamp as the new expected target while the
    // server round-trip completes, so drift correction doesn't undo a native seek.
    roomDrivenYouTubeSeekRef.current = { target: safePos, expiresAt: Date.now() + 1600 };
    socket.emit("playback:control", {
      code: latestRoom.code,
      clientId,
      action: "sync",
      position: safePos,
      isPlaying: playing,
    });
  }, [clientId]);
  const displayedPosition = room?.mediaUrl
    ? videoCurrentTime
    : room
      ? Math.max(0, room.position + (room.isPlaying ? Math.max(0, clockNow + (serverClockOffsetRef.current ?? 0) - room.serverNow) / 1000 : 0))
      : 0;
  const syncTargetPosition = room
    ? Math.max(0, room.position + (room.isPlaying ? Math.max(0, clockNow + (serverClockOffsetRef.current ?? 0) - room.serverNow) / 1000 : 0))
    : 0;
  const estimatedDriftMs = room?.mediaUrl ? Math.round(Math.abs(videoCurrentTime - syncTargetPosition) * 1000) : 0;
  const filteredChat = useMemo(() => {
    const term = chatFilter.trim().toLowerCase();
    return term ? chat.filter((item) => `${item.name} ${item.text}`.toLowerCase().includes(term)) : chat;
  }, [chat, chatFilter]);

  const join = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !clientId) return;
    setJoining(true);
    socket.timeout(8000).emit(
      "room:join",
      { code, clientId, name: displayName },
      (timeoutError: Error | null, response: Ack<{ room: RoomSnapshot }> | undefined) => {
        setJoining(false);
        if (timeoutError) {
          setJoinError("No response from the room server. Check the terminal and retry.");
          return;
        }
        if (!response || !response.ok) {
          setJoinError(response?.error || "Could not join room.");
          return;
        }
        setJoinError("");
        setRoom(response.room);
        setChat((old) => mergeMessages(old, response.room.messages || []));
        setSelectedMovie(response.room.movieTitle);
        lastMediaUrlRef.current = response.room.mediaUrl || "";
        setMediaUrlInput(response.room.mediaUrl || "");
      }
    );
  }, [clientId, code, displayName]);

  useEffect(() => {
    if (!clientId) return;
    const socket = getSocket();
    socketRef.current = socket;

    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setConnected(false);
    const sendClockPing = () => { if (socket.connected) socket.emit("clock:ping", { clientSentAt: Date.now() }); };
    const onClockPong = (payload: { clientSentAt: number; serverNow: number }) => {
      const receivedAt = Date.now();
      const roundTrip = Math.max(0, receivedAt - payload.clientSentAt);
      if (roundTrip > 2000) return;
      const measuredOffset = payload.serverNow - (payload.clientSentAt + roundTrip / 2);
      if (!Number.isFinite(measuredOffset)) return;
      const previous = serverClockOffsetRef.current;
      // Smooth subsequent samples so one unusually delayed ping does not jump playback.
      serverClockOffsetRef.current = previous === null ? measuredOffset : previous * 0.75 + measuredOffset * 0.25;
    };
    const onPlaybackState = (state: PlaybackSnapshot) => {
      if (state.code !== code) return;
      // Apply playback commands immediately instead of waiting for the next full
      // room snapshot. Ignore an event if a newer full snapshot is already here.
      setRoom((current) => {
        if (!current || current.code !== code || current.revision > state.revision) return current;
        return {
          ...current,
          isPlaying: state.isPlaying,
          position: state.position,
          serverNow: state.serverNow,
          revision: state.revision,
        };
      });
    };
    const onRoomState = (state: RoomSnapshot) => {
      if (state.code !== code) return;
      // The server's full room snapshot is the source of truth for presence. Merge
      // history by message ID so a state update can never wipe a live chat line.
      setRoom((current) => {
        // Revisions ensure a delayed room snapshot cannot roll back a newer
        // playback event or reconnect update.
        if (current && current.code === code && current.revision > state.revision) return current;
        return state;
      });
      setSelectedMovie(state.movieTitle);
      if (lastMediaUrlRef.current !== (state.mediaUrl || "")) {
        const previousYouTubeId = getYouTubeVideoId(lastMediaUrlRef.current || "");
        const nextYouTubeId = getYouTubeVideoId(state.mediaUrl || "");
        lastMediaUrlRef.current = state.mediaUrl || "";
        setMediaUrlInput(state.mediaUrl || "");
        setVideoError("");
        setAutoplayBlocked(false);
        setVideoCurrentTime(0);
        setVideoDuration(0);
        if (previousYouTubeId !== nextYouTubeId) setYoutubeReadyFor("");
      }
      if (!state.isPlaying) setAutoplayBlocked(false);
      setChat((old) => mergeMessages(old, state.messages || []));
    };
    const onMessage = (incoming: ChatMessage) => setChat((old) => mergeMessages(old, [incoming]));
    const onReaction = (incoming: Reaction) => {
      // Keep simultaneous reactions as separate stacked items. Each gets its own
      // expiry timer so a newer emoji never replaces an older one prematurely.
      setReactions((old) => [...old.slice(-5), incoming]);
      const timer = window.setTimeout(() => {
        setReactions((old) => old.filter((item) => item.id !== incoming.id));
        reactionTimersRef.current.delete(incoming.id);
      }, 2200);
      reactionTimersRef.current.set(incoming.id, timer);
    };
    const onPauseVoteState = (state: { code: string; participantIds: string[]; threshold: number }) => {
      if (state.code !== code) return;
      setRoom((current) => current && current.code === code ? {
        ...current,
        pauseVoteParticipantIds: state.participantIds,
        pauseVoteThreshold: state.threshold,
      } : current);
    };

    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("clock:pong", onClockPong);
    socket.on("room:state", onRoomState);
    socket.on("playback:state", onPlaybackState);
    socket.on("chat:message", onMessage);
    socket.on("reaction:new", onReaction);
    socket.on("pause-vote:state", onPauseVoteState);

    let clockPingTimer: number | undefined;
    const onConnectWithClockSync = () => {
      onConnect();
      sendClockPing();
      if (clockPingTimer !== undefined) window.clearInterval(clockPingTimer);
      clockPingTimer = window.setInterval(sendClockPing, 5000);
    };
    socket.on("connect", onConnectWithClockSync);
    if (socket.connected) onConnectWithClockSync();
    else socket.connect();

    return () => {
      socket.off("connect", onConnectWithClockSync);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("clock:pong", onClockPong);
      if (clockPingTimer !== undefined) window.clearInterval(clockPingTimer);
      socket.off("room:state", onRoomState);
      socket.off("playback:state", onPlaybackState);
      socket.off("chat:message", onMessage);
      socket.off("reaction:new", onReaction);
      socket.off("pause-vote:state", onPauseVoteState);
      for (const timer of reactionTimersRef.current.values()) window.clearTimeout(timer);
      reactionTimersRef.current.clear();
    };
  }, [clientId, code, join]);

  // Keep each player aligned to the server clock while playing AND while paused.
  // Paused clients are corrected too, so a local iframe interaction cannot leave
  // a guest at a different timestamp from the rest of the room.
  useEffect(() => {
    if (!room?.mediaUrl) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      const target = Math.max(0, room.position + (room.isPlaying ? Math.max(0, now + (serverClockOffsetRef.current ?? 0) - room.serverNow) / 1000 : 0));
      const video = videoRef.current;
      if (video) {
        if (video.readyState >= 1 && Number.isFinite(video.currentTime)) {
          const tolerance = room.isPlaying ? 0.4 : 0.25;
          if (Math.abs(video.currentTime - target) > tolerance) {
            try { video.currentTime = target; } catch { /* Wait until the media is seekable. */ }
          }
          if (room.isPlaying && video.paused && !autoplayBlocked) {
            void video.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
          } else if (!room.isPlaying && !video.paused) {
            video.pause();
          }
          setVideoCurrentTime(video.currentTime);
        }
        return;
      }

      const player = youtubePlayerRef.current;
      const states = window.YT?.PlayerState;
      if (!youtubeVideoId || !youtubeReady || !isYouTubePlayer(player) || !states) return;
      const current = safeGetCurrentTime(player);
      const state = safeGetPlayerState(player);
      if (current === null || state === null) return;
      if (state === states.UNSTARTED || state === states.CUED) return;

      const tolerance = room.isPlaying ? 0.4 : 0.2;
      const pendingSeek = roomDrivenYouTubeSeekRef.current;
      if (pendingSeek && Date.now() > pendingSeek.expiresAt) {
        roomDrivenYouTubeSeekRef.current = null;
      }
      const activePendingSeek = roomDrivenYouTubeSeekRef.current;
      const waitingForRoomSeek = Boolean(
        activePendingSeek && Date.now() <= activePendingSeek.expiresAt &&
        Math.abs(current - activePendingSeek.target) > tolerance,
      );

      if (Math.abs(current - target) > tolerance && !waitingForRoomSeek && state !== states.BUFFERING) {
        const previousObservedTime = lastObservedYouTubeTimeRef.current;
        const looksLikeNativeSeek = previousObservedTime !== null && Math.abs(current - previousObservedTime) > 2.5;
        if (isHostRef.current && looksLikeNativeSeek && !activePendingSeek) {
          publishNativeYouTubeState(current, room.isPlaying);
        } else {
          roomDrivenYouTubeSeekRef.current = { target, expiresAt: Date.now() + 1800 };
          try { player.seekTo(target, true); } catch { /* Wait for the player to become seekable. */ }
        }
      } else if (activePendingSeek && Math.abs(current - activePendingSeek.target) <= tolerance) {
        roomDrivenYouTubeSeekRef.current = null;
        lastObservedYouTubeTimeRef.current = current;
      }
      setVideoCurrentTime(current);

      if (room.isPlaying) {
        if (!autoplayBlocked && state !== states.PLAYING && state !== states.BUFFERING && !hostPendingPlayRef.current) {
          if (isHostRef.current && state === states.PAUSED && Date.now() >= programmaticYouTubePlaybackUntilRef.current) {
            publishNativeYouTubeState(current, false);
          } else {
            programmaticYouTubePlaybackUntilRef.current = Date.now() + 1500;
            try { player.playVideo(); } catch { /* ignore */ }
          }
        }
      } else if (state === states.PLAYING || state === states.BUFFERING) {
        if (isHostRef.current && state === states.PLAYING && Date.now() >= programmaticYouTubePlaybackUntilRef.current && !hostPendingPlayRef.current) {
          publishNativeYouTubeState(current, true);
        } else if (!hostPendingPlayRef.current) {
          programmaticYouTubePlaybackUntilRef.current = Date.now() + 1500;
          try { player.pauseVideo(); } catch { /* ignore */ }
        }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [room?.isPlaying, room?.mediaUrl, room?.position, room?.serverNow, youtubeVideoId, youtubeReady, autoplayBlocked, publishNativeYouTubeState]);

  // Load the official YouTube IFrame API only when a YouTube link is selected.
  useEffect(() => {
    if (!youtubeVideoId || !youtubeMountRef.current) return;
    let cancelled = false;
    let createdPlayer: YouTubePlayer | null = null;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !youtubeMountRef.current) return;
      createdPlayer = new YT.Player(youtubeMountRef.current, {
        videoId: youtubeVideoId,
        playerVars: {
          autoplay: 0,
          // YouTube exposes its transport buttons and Quality menu as one bundled UI.
          // Keep the bundle host-only: guest clicks would otherwise pause/seek only that tab.
          controls: isHost ? 1 : 0,
          disablekb: 1,
          fs: isHost ? 1 : 0,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (cancelled) return;
            // Use the API event's player object as the authoritative instance.
            // Do not mark the player ready if the API object lacks its methods.
            if (!isYouTubePlayer(event.target)) {
              setVideoError("YouTube player did not initialize correctly. Please reload the video.");
              return;
            }
            youtubePlayerRef.current = event.target;
            const current = safeGetCurrentTime(event.target) ?? 0;
            const latestRoom = roomRef.current;
            const initialTarget = latestRoom
              ? Math.max(0, latestRoom.position + (latestRoom.isPlaying ? Math.max(0, Date.now() + (serverClockOffsetRef.current ?? 0) - latestRoom.serverNow) / 1000 : 0))
              : current;
            lastObservedYouTubeTimeRef.current = initialTarget;
            const iframe = event.target.getIframe();
            iframe.style.position = "absolute";
            iframe.style.inset = "0";
            iframe.style.width = "100%";
            iframe.style.height = "100%";
            iframe.style.border = "0";
            // Guests receive a non-interactive player surface. The host can use the
            // native Quality menu and transport controls; native play/pause/seek is
            // committed back to the room from onStateChange below.
            iframe.style.pointerEvents = isHost ? "auto" : "none";
            iframe.tabIndex = isHost ? 0 : -1;
            iframe.setAttribute("aria-label", isHost
              ? "YouTube player controls; host playback actions are synchronized to the room"
              : "Synchronized YouTube video; use the shared controls below");
            setYoutubeReadyFor(youtubePlayerKey);
          },
          onStateChange: (event) => {
            if (cancelled || !isYouTubePlayer(event.target)) return;
            const current = safeGetCurrentTime(event.target);
            const duration = safeGetDuration(event.target);
            const states = window.YT?.PlayerState;
            if (current !== null) setVideoCurrentTime(current);
            if (duration !== null) setVideoDuration(duration);

            if (event.data === states?.PLAYING) {
              setAutoplayBlocked(false);
              if (hostPlayTimeoutRef.current) {
                window.clearTimeout(hostPlayTimeoutRef.current);
                hostPlayTimeoutRef.current = null;
              }
              const wasPendingHostPlay = hostPendingPlayRef.current;
              hostPendingPlayRef.current = false;
              setHostStartingPlayback(false);

              // Host has started playing (either via purple button or native controls).
              // The playback command is now valid and authoritative: publish to room.
              const latestRoom = roomRef.current;
              if (isHostRef.current && latestRoom && current !== null && (!latestRoom.isPlaying || wasPendingHostPlay)) {
                publishNativeYouTubeState(current, true);
              }
            }

            const latestRoom = roomRef.current;
            if (isHostRef.current && latestRoom && current !== null && states) {
              if (event.data === states.PAUSED) {
                const nearActualEnd = duration !== null && duration > 0 && duration - current < 0.35;
                if (latestRoom.isPlaying && !nearActualEnd) {
                  publishNativeYouTubeState(current, false);
                }
              }
              // Notice: BUFFERING is deliberately omitted here. Buffering events must NEVER
              // overwrite the shared playback position with transient or stale timestamps.
            }
            if (event.data === states?.ENDED) handleMediaEnded();
          },
          onError: (event) => {
            if (!cancelled) setVideoError(explainYouTubeError(event.data));
          },
        },
      });
      // Intentionally do not assign `createdPlayer` to youtubePlayerRef here.
      // The ref is populated from the verified onReady event target above.
    }).catch((error: unknown) => {
      if (!cancelled) {
        setVideoError(error instanceof Error ? error.message : "Could not load the YouTube player.");
      }
    });

    return () => {
      cancelled = true;
      if (hostPlayTimeoutRef.current) {
        window.clearTimeout(hostPlayTimeoutRef.current);
        hostPlayTimeoutRef.current = null;
      }
      const player = createdPlayer ?? youtubePlayerRef.current;
      if (player) {
        try { player.destroy(); } catch { /* Ignore an already-destroyed player. */ }
      }
      if (youtubePlayerRef.current === player) youtubePlayerRef.current = null;
    };
  }, [youtubeVideoId, youtubePlayerKey, isHost, publishNativeYouTubeState]);

  // If remote play was blocked by browser autoplay policy, ask the guest for one click.
  useEffect(() => {
    if (!youtubeVideoId || !youtubeReady || !room?.isPlaying) return;
    const timer = window.setTimeout(() => {
      const player = youtubePlayerRef.current;
      const state = safeGetPlayerState(player);
      const playing = window.YT?.PlayerState.PLAYING;
      const buffering = window.YT?.PlayerState.BUFFERING;
      if (player && state !== playing && state !== buffering) setAutoplayBlocked(true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [youtubeVideoId, youtubeReady, room?.isPlaying, room?.position, room?.serverNow]);

  // Poll the YouTube player clock because it doesn't emit HTML-video timeupdate events.
  useEffect(() => {
    if (!youtubeVideoId || !youtubeReady) return;
    const timer = window.setInterval(() => {
      const player = youtubePlayerRef.current;
      if (!isYouTubePlayer(player)) return;
      const current = safeGetCurrentTime(player);
      const duration = safeGetDuration(player);
      const state = safeGetPlayerState(player);
      const states = window.YT?.PlayerState;
      if (current === null) return;

      const now = Date.now();
      const previous = lastObservedYouTubeTimeRef.current;
      const pendingSeek = roomDrivenYouTubeSeekRef.current;
      if (pendingSeek && now > pendingSeek.expiresAt) roomDrivenYouTubeSeekRef.current = null;
      const activePendingSeek = roomDrivenYouTubeSeekRef.current;
      const waitingForRoomSeek = Boolean(
        activePendingSeek && now <= activePendingSeek.expiresAt &&
        Math.abs(current - activePendingSeek.target) > 2.5,
      );

      // Only evaluate native timeline scrub when player is in an active, stable state (not buffering/unstarted/cued)
      const isBufferingOrUnstarted = !states || state === states.BUFFERING || state === states.UNSTARTED || state === states.CUED;
      if (
        isHostRef.current &&
        !isBufferingOrUnstarted &&
        previous !== null &&
        Math.abs(current - previous) > 2.5 &&
        !waitingForRoomSeek &&
        !activePendingSeek
      ) {
        publishNativeYouTubeState(current, roomRef.current?.isPlaying ?? false);
      }
      if (activePendingSeek && Math.abs(current - activePendingSeek.target) <= 2.5) {
        roomDrivenYouTubeSeekRef.current = null;
      }
      lastObservedYouTubeTimeRef.current = current;
      setVideoCurrentTime(current);
      if (duration !== null) setVideoDuration(duration);
    }, 250);
    return () => window.clearInterval(timer);
  }, [youtubeVideoId, youtubeReady, publishNativeYouTubeState]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [chat.length]);

  useEffect(() => {
    const updateFullscreenState = () => setFullscreenActive(document.fullscreenElement === playerShellRef.current);
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  // Apply the authoritative server playback state to the HTML video element.
  // A guest browser may block autoplay; the UI then asks them to enable playback.
  useEffect(() => {
    if (!room?.mediaUrl) return;
    const target = Math.max(0, room.position + (room.isPlaying ? Math.max(0, Date.now() + (serverClockOffsetRef.current ?? 0) - room.serverNow) / 1000 : 0));

    if (youtubeVideoId) {
      const player = youtubePlayerRef.current;
      if (!isYouTubePlayer(player) || !youtubeReady) return;
      const current = safeGetCurrentTime(player);
      if (current !== null && Math.abs(current - target) > 0.4) {
        roomDrivenYouTubeSeekRef.current = { target, expiresAt: Date.now() + 1800 };
        try { player.seekTo(target, true); } catch { /* The YouTube player may still be buffering. */ }
      }
      const playerState = safeGetPlayerState(player);
      const states = window.YT?.PlayerState;
      if (room.isPlaying) {
        if (states && playerState !== states.PLAYING && playerState !== states.BUFFERING && !hostPendingPlayRef.current) {
          programmaticYouTubePlaybackUntilRef.current = Date.now() + 1500;
          try { player.playVideo(); } catch { /* ignore */ }
        }
      } else if (states && (playerState === states.PLAYING || playerState === states.BUFFERING)) {
        if (!hostPendingPlayRef.current) {
          programmaticYouTubePlaybackUntilRef.current = Date.now() + 1500;
          try { player.pauseVideo(); } catch { /* ignore */ }
        }
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= 1) {
      if (Math.abs(video.currentTime - target) > 0.4) {
        try { video.currentTime = target; } catch { /* The media metadata may still be changing. */ }
      }
      setVideoCurrentTime(video.currentTime);
    }
    if (room.isPlaying) {
      void video.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
    } else {
      video.pause();
    }
  }, [room?.mediaUrl, room?.isPlaying, room?.position, room?.serverNow, youtubeVideoId, youtubeReady]);

  function control(action: "play" | "pause" | "seek" | "skip", positionOrDelta?: number) {
    if (!room || !socketRef.current || !connected || !isHost) return;

    // Skip is deliberately not calculated from displayedPosition on the client.
    // The server applies each +/-10s delta to its latest authoritative clock, so
    // rapid clicks cannot collapse into the same stale absolute target.
    if (action === "skip") {
      const player = youtubePlayerRef.current;
      const duration = youtubeVideoId
        ? (safeGetDuration(player) ?? videoDuration)
        : (videoRef.current?.duration ?? videoDuration);
      socketRef.current.emit("playback:control", { code, clientId, action, delta: positionOrDelta, duration });
      return;
    }

    if (action === "seek") {
      socketRef.current.emit("playback:control", { code, clientId, action, position: positionOrDelta });
      return;
    }

    if (action === "pause") {
      if (hostPlayTimeoutRef.current) {
        window.clearTimeout(hostPlayTimeoutRef.current);
        hostPlayTimeoutRef.current = null;
      }
      hostPendingPlayRef.current = false;
      setHostStartingPlayback(false);

      if (youtubeVideoId) {
        const player = youtubePlayerRef.current;
        if (isYouTubePlayer(player)) {
          programmaticYouTubePlaybackUntilRef.current = Date.now() + 1500;
          try { player.pauseVideo(); } catch { /* ignore */ }
          const current = safeGetCurrentTime(player) ?? displayedPosition;
          publishNativeYouTubeState(current, false);
          return;
        }
      } else if (videoRef.current) {
        videoRef.current.pause();
        const current = Number.isFinite(videoRef.current.currentTime) ? videoRef.current.currentTime : displayedPosition;
        socketRef.current.emit("playback:control", { code, clientId, action: "pause", position: current });
        return;
      }
      socketRef.current.emit("playback:control", { code, clientId, action: "pause", position: positionOrDelta });
      return;
    }

    if (action === "play") {
      if (youtubeVideoId) {
        const player = youtubePlayerRef.current;
        if (!isYouTubePlayer(player) || !youtubeReady) return;

        // Synchronous user gesture initiates local playback to satisfy browser autoplay policy.
        // We do NOT broadcast play to guests until the host actually starts playing!
        setAutoplayBlocked(false);
        hostPendingPlayRef.current = true;
        setHostStartingPlayback(true);
        programmaticYouTubePlaybackUntilRef.current = Date.now() + 3000;
        try { player.playVideo(); } catch { /* ignore */ }

        if (hostPlayTimeoutRef.current) window.clearTimeout(hostPlayTimeoutRef.current);
        hostPlayTimeoutRef.current = window.setTimeout(() => {
          if (hostPendingPlayRef.current) {
            hostPendingPlayRef.current = false;
            setHostStartingPlayback(false);
            const state = safeGetPlayerState(youtubePlayerRef.current);
            const playing = window.YT?.PlayerState.PLAYING;
            const buffering = window.YT?.PlayerState.BUFFERING;
            if (state !== playing && state !== buffering) {
              setAutoplayBlocked(true);
            }
          }
        }, 3000);
        return;
      }

      if (videoRef.current) {
        const video = videoRef.current;
        setAutoplayBlocked(false);
        void video.play().then(() => {
          setAutoplayBlocked(false);
          const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
          socketRef.current?.emit("playback:control", { code, clientId, action: "play", position: current });
        }).catch(() => {
          setAutoplayBlocked(true);
        });
        return;
      }

      socketRef.current.emit("playback:control", { code, clientId, action: "play", position: positionOrDelta });
    }
  }

  // Restart playback atomically when the host reaches the end. Use refs because the
  // YouTube IFrame API keeps the callback created at player-load time; reading room
  // or isHost directly there can see stale values (usually the initial paused state).
  function handleMediaEnded() {
    const latestRoom = roomRef.current;
    const socket = socketRef.current;
    if (
      !isHostRef.current ||
      !latestRoom?.mediaUrl ||
      !latestRoom.isPlaying ||
      !socket?.connected ||
      endLoopInProgressRef.current
    ) return;

    endLoopInProgressRef.current = true;
    // YouTube can fire follow-on paused/buffering callbacks around ENDED; suppress
    // those callbacks briefly so they cannot overwrite the atomic restart command.
    programmaticYouTubePlaybackUntilRef.current = Date.now() + 2500;
    // One server command resets both the anchor and the playing state; a seek followed
    // by a delayed play allowed the authoritative clock to drift and caused 1-second loops.
    socket.emit("playback:control", { code: latestRoom.code, clientId, action: "restart" });
    window.setTimeout(() => { endLoopInProgressRef.current = false; }, 2500);
  }

  function enablePlaybackForThisBrowser() {
    // Browsers may require a local gesture before a remote play command is allowed.
    // If guest: unlocks the already-playing shared state without changing room controls.
    // If host: user interaction resumes playback and triggers authoritative sync.
    setAutoplayBlocked(false);
    if (!room?.mediaUrl) return;

    if (isHost && !room.isPlaying) {
      control("play");
      return;
    }

    const target = Math.max(0, room.position + Math.max(0, Date.now() + (serverClockOffsetRef.current ?? 0) - room.serverNow) / 1000);
    if (youtubeVideoId) {
      const player = youtubePlayerRef.current;
      if (!isYouTubePlayer(player) || !youtubeReady) return;
      roomDrivenYouTubeSeekRef.current = { target, expiresAt: Date.now() + 1800 };
      try { player.seekTo(target, true); } catch { /* The player may still be initializing. */ }
      programmaticYouTubePlaybackUntilRef.current = Date.now() + 1500;
      try { player.playVideo(); } catch { /* ignore */ }
      window.setTimeout(() => {
        const currentPlayer = youtubePlayerRef.current;
        const state = safeGetPlayerState(currentPlayer);
        const states = window.YT?.PlayerState;
        if (currentPlayer && states && state !== states.PLAYING && state !== states.BUFFERING) setAutoplayBlocked(true);
      }, 1800);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    try { video.currentTime = target; } catch { /* The source may not be seekable yet. */ }
    void video.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || !socketRef.current || !connected) return;
    socketRef.current.emit("chat:send", { code, clientId, text });
    setMessage("");
  }

  function sendReaction(emoji: string) { socketRef.current?.emit("reaction:send", { code, clientId, emoji }); }

  function addPlaylistItem(event: FormEvent) {
    event.preventDefault();
    if (!connected || !socketRef.current) return;
    const title = playlistTitle.trim().slice(0, 100);
    const normalized = normalizeMediaUrl(playlistUrl);
    if (!title) { setRoomActionStatus("Enter a title for the playlist item."); return; }
    if (!normalized || !normalized.trim()) { setRoomActionStatus("Enter a valid YouTube link or direct video URL."); return; }
    socketRef.current.emit("playlist:add", { code, clientId, title, mediaUrl: normalized });
    setPlaylistTitle("");
    setPlaylistUrl("");
    setRoomActionStatus("Playlist request sent to the room.");
  }

  function removePlaylistItem(item: PlaylistItem) {
    socketRef.current?.emit("playlist:remove", { code, clientId, itemId: item.id });
  }

  function playPlaylistItem(item: PlaylistItem) {
    if (!isHost || !connected) return;
    socketRef.current?.emit("playlist:play", { code, clientId, itemId: item.id });
    setRoomActionStatus(`Loaded “${item.title}” for the room. Press Play when ready.`);
  }

  function createPoll(event: FormEvent) {
    event.preventDefault();
    if (!connected || !socketRef.current) return;
    const question = pollQuestion.trim().slice(0, 160);
    const options = Array.from(new Set(pollOptionsInput.split(/[\n,]/).map((option) => option.trim()).filter(Boolean))).slice(0, 6);
    if (!question) { setRoomActionStatus("Add a question for your group poll."); return; }
    if (options.length < 2) { setRoomActionStatus("Enter at least two poll options, separated by commas."); return; }
    socketRef.current.emit("poll:create", { code, clientId, question, options });
    setPollQuestion("");
    setPollOptionsInput("Yes,No");
    setRoomActionStatus("Poll creation request sent to the room.");
  }

  function votePoll(pollId: string, optionIndex: number) {
    socketRef.current?.emit("poll:vote", { code, clientId, pollId, optionIndex });
  }

  function closePoll(pollId: string) {
    socketRef.current?.emit("poll:close", { code, clientId, pollId });
  }

  function transferHost(targetParticipantId: string) {
    const socket = socketRef.current;
    if (!socket || !connected || !isHost) return;
    socket.timeout(8000).emit(
      "room:host-transfer",
      { code, clientId, targetParticipantId },
      (timeoutError: Error | null, response: Ack<{ room: RoomSnapshot }> | undefined) => {
        if (timeoutError) { setRoomActionStatus("Host transfer timed out. Check the connection and try again."); return; }
        if (!response || !response.ok) { setRoomActionStatus(response?.error || "Could not transfer host privileges."); return; }
        setRoom(response.room);
        setRoomActionStatus(`Host role transferred to ${response.room.participants.find((person) => person.id === targetParticipantId)?.name || "the selected member"}.`);
      },
    );
  }

  async function toggleFullscreen() {
    const shell = playerShellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch {
      setRoomActionStatus("Fullscreen is unavailable in this browser or was blocked by browser settings.");
    }
  }

  function updateMovie() {
    if (!isHost || !connected) return;
    socketRef.current?.emit("room:movie", { code, clientId, movieTitle: selectedMovie });
    setMediaStatus("Room title updated for everyone.");
  }

  function loadMedia(value = mediaUrlInput) {
    if (!isHost || !connected || !socketRef.current) return;
    const normalized = normalizeMediaUrl(value);
    if (normalized === null) {
      setMediaStatus("Paste a YouTube link or a direct HTTP(S) MP4/WebM video URL.");
      return;
    }
    // When a real catalogue item is selected, publish its title before the
    // source update. Socket.IO preserves event order on one connection, so the
    // server processes the title first and the room:media acknowledgement then
    // contains the updated title. Keep the existing title when the placeholder
    // is selected or when the host is clearing the source.
    const selectedTitle = selectedMovie.trim();
    if (normalized && selectedTitle && selectedTitle !== "Choose a movie") {
      socketRef.current.emit("room:movie", { code, clientId, movieTitle: selectedTitle });
    }
    setMediaStatus(
      normalized && selectedTitle && selectedTitle !== "Choose a movie"
        ? `Sharing “${selectedTitle}” with everyone…`
        : "Updating the shared source…",
    );
    setVideoError("");
    setAutoplayBlocked(false);
    socketRef.current.timeout(8000).emit(
      "room:media",
      { code, clientId, mediaUrl: normalized },
      (timeoutError: Error | null, response: Ack<{ room: RoomSnapshot }> | undefined) => {
        if (timeoutError) {
          setMediaStatus("The server did not confirm the source update. Check your connection and retry.");
          return;
        }
        if (!response || !response.ok) {
          setMediaStatus(response?.error || "Could not update the video source.");
          return;
        }
        setRoom(response.room);
        lastMediaUrlRef.current = response.room.mediaUrl || "";
        setMediaUrlInput(response.room.mediaUrl || "");
        setVideoCurrentTime(0);
        setVideoDuration(0);
        setMediaStatus(
          response.room.mediaUrl
            ? `“${response.room.movieTitle || selectedTitle}” and its video source are shared with everyone.`
            : "Video source cleared.",
        );
      }
    );
  }

  async function copyInvite() {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Invite link copied");
    } catch {
      setCopyStatus(url);
    }
    window.setTimeout(() => setCopyStatus(""), 3500);
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopyStatus("Room code copied"); }
    catch { setCopyStatus(`Room code: ${code}`); }
    window.setTimeout(() => setCopyStatus(""), 3500);
  }

  function goHome() {
    socketRef.current?.emit("room:leave", { code, clientId });
    router.push("/");
  }

  if (joining && !room && !joinError) {
    return <main className="flex min-h-screen items-center justify-center bg-[#08090d] px-5 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-violet-400/20 border-t-violet-400" /><p className="font-semibold">Connecting to room {code}…</p><p className="mt-2 text-sm text-zinc-500">Getting the latest room state</p></div></main>;
  }

  if (joinError && !room) {
    return <main className="flex min-h-screen items-center justify-center bg-[#08090d] px-5 text-white"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111219] p-6 sm:p-8"><p className="text-xs font-bold tracking-[0.2em] text-rose-300">ROOM CONNECTION</p><h1 className="mt-3 text-2xl font-bold">Couldn&apos;t join this room</h1><p className="mt-3 text-sm leading-6 text-zinc-400">{joinError}</p><div className="mt-6 flex flex-wrap gap-2"><button onClick={() => router.push("/")} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold">Back home</button><button onClick={() => { setJoinError(""); join(); }} className="rounded-xl border border-white/10 px-5 py-3 font-semibold transition hover:bg-white/5">Retry</button></div></div></main>;
  }

  return (
    <main className="min-h-screen bg-[#08090d] px-4 py-5 text-white sm:px-7 sm:py-7">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3"><button onClick={goHome} aria-label="Back home" className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-zinc-300 transition hover:bg-white/10">←</button><div><p className="text-[10px] font-bold tracking-[0.22em] text-violet-400">WATCH PARTY ROOM</p><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{room?.movieTitle || "Movie night"}</h1><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400"><span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono font-bold tracking-[0.18em] text-violet-200">{code}</span><button onClick={copyCode} className="hover:text-white">Copy code</button><span className="text-zinc-700">·</span><span className={`flex items-center gap-1.5 ${connected ? "text-emerald-300" : "text-amber-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />{connected ? "Live connection" : "Reconnecting…"}</span></div></div></div>
          <div className="flex flex-wrap gap-2 md:justify-end"><button onClick={copyInvite} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold transition hover:bg-white/10">↗ Share invite</button><button onClick={() => setShowDetails((value) => !value)} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-white/5">Room details {showDetails ? "−" : "+"}</button></div>
        </header>

        {showDetails && <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm sm:grid-cols-3"><div><p className="text-xs text-zinc-500">Your identity</p><p className="mt-1 font-semibold">{displayName}{isHost ? " · Host" : ""}</p></div><div><p className="text-xs text-zinc-500">Room capacity</p><p className="mt-1 font-semibold">{room?.participants.length || 0} / 25 people</p></div><div><p className="text-xs text-zinc-500">Shared video source</p><p className="mt-1 break-all font-medium text-zinc-300">{room?.mediaUrl ? room.mediaUrl : "Not set yet"}</p></div></div>}
        {copyStatus && <p role="status" className="mt-3 inline-flex max-w-full break-all rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">{copyStatus}</p>}
        {roomActionStatus && <p role="status" className="mt-3 inline-flex max-w-full break-words rounded-lg border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-xs text-violet-200">{roomActionStatus}</p>}
        {joinError && room && <p role="status" className="mt-3 text-sm text-amber-200">{joinError}</p>}
        {reactions.length > 0 && <div className="pointer-events-none fixed left-1/2 top-20 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">{reactions.map((item) => <div key={item.id} className="animate-in fade-in slide-in-from-top-2 rounded-full border border-violet-400/30 bg-[#171322]/95 px-6 py-3 text-xl shadow-2xl shadow-violet-950/40 backdrop-blur">{item.emoji}<span className="ml-2 text-sm font-semibold">{item.name}</span></div>)}</div>}

        <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
          <section className="min-w-0 space-y-5">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111219] shadow-xl shadow-black/20">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-5"><div><p className="text-[10px] font-bold tracking-[0.2em] text-violet-300">THE WATCH ROOM</p><p className="mt-1 text-xs text-zinc-500">{room?.mediaUrl ? "One source · synced controls" : "Set a source to play video together"}</p></div><div className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400"><span className={`h-1.5 w-1.5 rounded-full ${room?.isPlaying ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`} />{room?.isPlaying ? "Playing" : "Paused"}</div></div>
              <div ref={playerShellRef} className="watch-player-shell relative flex aspect-video min-h-[220px] items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-950 via-[#100f18] to-black">
                {room?.mediaUrl ? youtubeVideoId ? <div key={`youtube-${youtubeVideoId}-${videoRetryKey}-${isHost ? "host" : "guest"}`} className="absolute inset-0 bg-black"><div ref={youtubeMountRef} className="h-full w-full" />{!youtubeReady && !videoError && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-5 text-center text-sm text-zinc-300">Loading YouTube player…</div>}</div> : <video key={`${room.mediaUrl}-${videoRetryKey}`} ref={videoRef} src={room.mediaUrl} playsInline preload="metadata" onLoadedMetadata={(event) => { const video = event.currentTarget; setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0); const target = room.position + (room.isPlaying ? Math.max(0, Date.now() + (serverClockOffsetRef.current ?? 0) - room.serverNow) / 1000 : 0); try { if (Math.abs(video.currentTime - target) > 0.4) video.currentTime = target; } catch { /* Ignore early metadata updates. */ } }} onTimeUpdate={(event) => setVideoCurrentTime(event.currentTarget.currentTime)} onEnded={handleMediaEnded} onDurationChange={(event) => setVideoDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onError={(event) => setVideoError(explainDirectVideoError(event.currentTarget.error?.code))} className="absolute inset-0 h-full w-full bg-black object-contain" /> : <div className="relative z-10 max-w-lg px-6 py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-500/10 text-3xl text-violet-200">▶</div><p className="mt-5 text-[10px] font-bold tracking-[0.24em] text-violet-300">READY WHEN YOU ARE</p><h2 className="mt-2 text-2xl font-black sm:text-3xl">Bring the video.</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-400">Use a YouTube link or a direct video URL. Load the included sample clip to test synchronization instantly.</p></div>}
                {videoError && room?.mediaUrl && <div className="absolute inset-x-3 bottom-3 z-20 flex flex-col gap-2 rounded-xl border border-rose-400/25 bg-black/85 p-3 text-xs leading-5 text-rose-100 backdrop-blur sm:flex-row sm:items-center sm:justify-between"><span>{videoError}</span><button onClick={() => { setVideoError(""); setAutoplayBlocked(false); setVideoRetryKey((value) => value + 1); }} className="shrink-0 rounded-lg border border-white/15 px-3 py-2 font-semibold hover:bg-white/10">Retry source</button></div>}
                {autoplayBlocked && room?.mediaUrl && <div className="absolute inset-x-3 bottom-3 z-20 flex flex-col gap-2 rounded-xl border border-amber-300/20 bg-black/85 p-3 text-xs text-amber-100 backdrop-blur sm:flex-row sm:items-center sm:justify-between"><span>{isHost ? "Your browser blocked playback. Tap to start playback for this room." : "Your browser blocked autoplay. Tap to resume the host's current playback in this browser; this does not change room controls."}</span><button onClick={enablePlaybackForThisBrowser} className="shrink-0 rounded-lg bg-amber-200 px-3 py-2 font-bold text-black">{isHost ? "Start playback" : "Enable playback"}</button></div>}
                {room?.mediaUrl && <button type="button" onClick={toggleFullscreen} title={fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"} aria-label={fullscreenActive ? "Exit fullscreen video" : "Fullscreen video"} className="absolute right-3 top-3 z-30 rounded-lg border border-white/20 bg-black/75 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur transition hover:bg-black">{fullscreenActive ? "↙ Exit fullscreen" : "⛶ Fullscreen"}</button>}
              </div>
              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{room?.mediaUrl ? "Synchronized playback" : "Playback controls"}</p><p className="mt-1 text-xs text-zinc-500">{room?.mediaUrl ? "Host commands update the video for everyone. Pause votes pause the room when enough people agree." : "Load a video source first to enable play, pause, and seek."}</p></div><p className="font-mono text-xl font-bold tabular-nums">{formatTime(displayedPosition)} <span className="text-sm font-medium text-zinc-500">/ {formatTime(videoDuration)}</span></p></div>
                <div className="flex flex-wrap items-center gap-2"><button disabled={!isHost || !connected || !room?.mediaUrl || !isPlayerReady} onClick={() => control(room?.isPlaying ? "pause" : "play")} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-35">{room?.isPlaying ? "Ⅱ Pause" : hostStartingPlayback ? "Starting…" : (!isPlayerReady && youtubeVideoId ? "Loading player…" : "▶ Play")}</button><button disabled={!isHost || !connected || !room?.mediaUrl || !isPlayerReady} onClick={() => control("skip", -10)} className="rounded-xl border border-white/10 px-3 py-3 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-35">−10 sec</button><button disabled={!isHost || !connected || !room?.mediaUrl || !isPlayerReady || videoDuration <= 0 || displayedPosition + 10 >= videoDuration - 0.35} title={videoDuration <= 0 || displayedPosition + 10 >= videoDuration - 0.35 ? "Skip is unavailable until duration is known or if it would reach the end of the video" : undefined} onClick={() => control("skip", 10)} className="rounded-xl border border-white/10 px-3 py-3 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-35">+10 sec</button>{!isHost && <button disabled={!connected || !room?.mediaUrl || !room.isPlaying} onClick={() => socketRef.current?.emit("pause-vote:toggle", { code, clientId })} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition disabled:opacity-35 ${room?.pauseVoteParticipantIds?.includes(clientId) ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 hover:bg-white/5"}`}>{room?.pauseVoteParticipantIds?.includes(clientId) ? "✓ Pause vote sent" : `⏸ Request pause (${room?.pauseVoteParticipantIds?.length || 0}/${room?.pauseVoteThreshold || 1})`}</button>}<span className="ml-auto text-xs text-zinc-600">{isHost ? "You are the host" : "Host controls playback"}</span></div>
                {room?.mediaUrl && <p className={`text-[10px] ${estimatedDriftMs <= 500 ? "text-emerald-300/80" : "text-amber-200"}`} aria-live="polite">Estimated local player drift: {estimatedDriftMs} ms · updates every 250 ms · compare between browsers to verify the 500 ms target.</p>}
                {room?.mediaUrl && <div><label htmlFor="seek-video" className="sr-only">Seek video</label><input id="seek-video" type="range" min={0} max={Math.max(videoDuration, 1)} step="0.25" disabled={!isHost || !connected || !isPlayerReady} value={Math.min(seekDraft ?? displayedPosition, Math.max(videoDuration, 1))} onChange={(event) => setSeekDraft(Number(event.target.value))} onPointerUp={(event) => { const value = Number(event.currentTarget.value); setSeekDraft(null); control("seek", value); }} onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") { const value = Number(event.currentTarget.value); setSeekDraft(null); control("seek", value); } }} className="w-full cursor-pointer accent-violet-500 disabled:cursor-not-allowed disabled:opacity-35" /><div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>Start</span><span>Scrub to seek (host)</span><span>{formatTime(videoDuration)}</span></div></div>}
                {youtubeVideoId && <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs leading-5 text-zinc-400">{isHost ? <>Use the shared controls below for playback and seek. YouTube chooses quality adaptively for each viewer; this app cannot force guests to match the host’s exact resolution or FPS. The native Quality menu is host-only because YouTube bundles it with local playback controls.</> : <>Use the shared controls below for playback and seeking. YouTube chooses this viewer’s quality based on their connection and device, so it may differ from the host. Guest player controls are disabled to prevent local-only pauses and seeks.</>}</p>}
              </div>
            </div>

            <section className="rounded-2xl border border-white/10 bg-[#111219] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.2em] text-violet-300">SHARED MEDIA</p><h2 className="mt-1 text-lg font-bold">Video source</h2></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${room?.mediaUrl ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{room?.mediaUrl ? "Source set" : "Waiting for host"}</span></div>
              {isHost ? <><form onSubmit={(event) => { event.preventDefault(); loadMedia(); }} className="mt-4 flex flex-col gap-2 sm:flex-row"><label htmlFor="media-url" className="sr-only">YouTube link or direct video URL</label><input id="media-url" type="url" inputMode="url" value={mediaUrlInput} onChange={(event) => setMediaUrlInput(event.target.value)} maxLength={2048} placeholder="YouTube link or https://example.com/video.mp4" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none transition placeholder:text-zinc-600 focus:border-violet-400" /><button type="submit" disabled={!connected} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-violet-100 disabled:opacity-40">Share source</button></form><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => { setMediaUrlInput(SAMPLE_VIDEO_URL); loadMedia(SAMPLE_VIDEO_URL); }} disabled={!connected} className="rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-40">Load sample video ↗</button><button onClick={() => { setMediaUrlInput(""); loadMedia(""); }} disabled={!connected || !room?.mediaUrl} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-white/5 disabled:opacity-35">Clear source</button><button onClick={updateMovie} disabled={!connected} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/5 disabled:opacity-40">Update room title</button></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><label htmlFor="movie-title" className="sr-only">Room title</label><select id="movie-title" value={selectedMovie} onChange={(event) => setSelectedMovie(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#171322] px-3 py-3 text-sm outline-none focus:border-violet-400">{movieOptions.map((movie) => <option key={movie} value={movie}>{movie}</option>)}</select><p className="self-center text-xs text-zinc-600">Choose a title, then share the source. Loading it updates the title for everyone.</p></div></> : <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-4"><p className="break-all text-sm text-zinc-300">{room?.mediaUrl || "The host hasn't shared a video source yet."}</p><p className="mt-2 text-xs leading-5 text-zinc-500">For copyright and access reasons, every participant must be allowed to access the source. Use a YouTube link that allows embedding or a direct video file URL you are permitted to share.</p></div>}
              {mediaStatus && <p role="status" className="mt-3 break-words text-xs leading-5 text-violet-200">{mediaStatus}</p>}
              <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11px] leading-5 text-zinc-600">Supported: YouTube watch/share links that allow embedding, plus direct HTTP(S) MP4/WebM files. Some YouTube videos disable embedding; protected streaming-service pages are not supported.</p>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111219] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[10px] font-bold tracking-[0.2em] text-violet-300">SHARED QUEUE</p><h2 className="mt-1 text-lg font-bold">Watchlist / playlist</h2><p className="mt-1 text-xs text-zinc-500">Everyone can add a valid media link. The host chooses when to load an item.</p></div><span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400">{room?.playlist?.length || 0} / 30</span></div>
              <form onSubmit={addPlaylistItem} className="mt-4 grid gap-2 sm:grid-cols-2">
                <label className="sr-only" htmlFor="playlist-title">Playlist title</label><input id="playlist-title" value={playlistTitle} onChange={(event) => setPlaylistTitle(event.target.value)} maxLength={100} placeholder="Movie or clip title" className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-violet-400" />
                <label className="sr-only" htmlFor="playlist-url">Playlist media URL</label><input id="playlist-url" type="url" value={playlistUrl} onChange={(event) => setPlaylistUrl(event.target.value)} maxLength={2048} placeholder="YouTube or direct video URL" className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-violet-400" />
                <button disabled={!connected} type="submit" className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40 sm:col-span-2">+ Add to shared playlist</button>
              </form>
              <div className="mt-4 space-y-2">{!room?.playlist?.length && <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">The playlist is empty. Add a video link above.</p>}{room?.playlist?.map((item, index) => <div key={item.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 sm:flex-row sm:items-center"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-xs font-bold text-violet-200">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 truncate text-[10px] text-zinc-500">Added by {item.addedByName} · {item.mediaUrl}</p></div>{isHost && <button onClick={() => playPlaylistItem(item)} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold hover:bg-violet-500">Load for room</button>}{(isHost || item.addedBy === clientId) && <button onClick={() => removePlaylistItem(item)} aria-label={`Remove ${item.title}`} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-400 hover:bg-white/5">Remove</button>}</div>)}</div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111219] p-4 sm:p-5">
              <div><p className="text-[10px] font-bold tracking-[0.2em] text-violet-300">GROUP DECISIONS</p><h2 className="mt-1 text-lg font-bold">Room polls</h2><p className="mt-1 text-xs text-zinc-500">Create a vote for the next movie, snack choice, or watch-party decision. Each participant gets one vote per poll.</p></div>
              <form onSubmit={createPoll} className="mt-4 space-y-2"><label className="sr-only" htmlFor="poll-question">Poll question</label><input id="poll-question" value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} maxLength={160} placeholder="What should we watch next?" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-violet-400" /><label className="sr-only" htmlFor="poll-options">Poll options</label><input id="poll-options" value={pollOptionsInput} onChange={(event) => setPollOptionsInput(event.target.value)} maxLength={400} placeholder="Interstellar, Inception, Dune" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-violet-400" /><p className="text-[10px] text-zinc-600">Enter 2–6 options separated by commas.</p><button disabled={!connected} type="submit" className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40">+ Create poll</button></form>
              <div className="mt-4 space-y-3">{!room?.polls?.length && <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">No polls yet. Start the first group vote.</p>}{room?.polls?.map((poll: GroupPoll) => { const voteCount = Object.keys(poll.votes || {}).length; const ownVote = poll.votes?.[clientId]; return <article key={poll.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3"><div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{poll.question}</h3><p className="mt-1 text-[10px] text-zinc-500">By {poll.createdByName} · {voteCount} vote{voteCount === 1 ? "" : "s"} · {poll.isOpen ? "Open" : "Closed"}</p></div>{poll.isOpen && (isHost || poll.createdBy === clientId) && <button onClick={() => closePoll(poll.id)} className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-semibold text-zinc-400 hover:bg-white/5">Close poll</button>}</div><div className="mt-3 space-y-2">{poll.options.map((option, index) => { const count = Object.values(poll.votes || {}).filter((selected) => selected === index).length; const percent = voteCount ? Math.round((count / voteCount) * 100) : 0; return <button key={`${poll.id}-${index}`} disabled={!poll.isOpen || !connected} onClick={() => votePoll(poll.id, index)} className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-xs transition disabled:cursor-default ${ownVote === index ? "border-violet-400/40 bg-violet-500/10 text-violet-100" : "border-white/[0.07] hover:border-white/20"}`}><span className="absolute inset-y-0 left-0 bg-violet-500/10 transition-all" style={{ width: `${percent}%` }} /><span className="relative flex items-center justify-between gap-2"><span>{option}{ownVote === index ? " ✓" : ""}</span><span>{count} · {percent}%</span></span></button>; })}</div></article>; })}</div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111219] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold">People in this room</h2><p className="mt-1 text-xs text-zinc-500">Live presence from the server, including reconnecting sessions.</p></div><span className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300">{room?.participants.length || 0} / 25</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{room?.participants.map((person) => <div key={person.id} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 ${person.connected ? "border-white/[0.08] bg-white/[0.025]" : "border-amber-500/20 bg-amber-500/[0.04]"}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 font-bold shadow-lg shadow-violet-950/30">{person.name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{person.name}{person.id === clientId ? <span className="ml-1 text-[10px] text-zinc-500">(you)</span> : null}</p><p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500"><span className={`h-1.5 w-1.5 rounded-full ${person.connected ? "bg-emerald-400" : "bg-amber-400"}`} />{person.connected ? "Connected" : "Reconnecting"}</p></div>{person.isHost && <span className="rounded-md bg-violet-400/10 px-2 py-1 text-[10px] font-bold text-violet-200">HOST</span>}{isHost && person.id !== clientId && person.connected && <button onClick={() => transferHost(person.id)} className="rounded-lg border border-violet-400/25 px-2 py-1.5 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/10">Make host</button>}</div>)}</div>{(room?.participants.length || 0) < 2 && <p className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs leading-5 text-zinc-500">Your room is waiting for friends. Use <button onClick={copyInvite} className="font-semibold text-violet-300 underline decoration-violet-400/30 underline-offset-2">Share invite</button> or send them the six-character code above.</p>}</section>
          </section>

          <aside className="flex min-h-[620px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111219] xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)]">
            <div className="border-b border-white/[0.07] p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-bold tracking-[0.2em] text-violet-300">THE LOBBY</p><h2 className="mt-1 text-lg font-bold">Room chat</h2></div><span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">LIVE</span></div><p className="mt-2 text-xs leading-5 text-zinc-500">Keep the comments coming. Everyone in the room sees new messages.</p><label htmlFor="chat-search" className="sr-only">Search chat messages</label><input id="chat-search" value={chatFilter} onChange={(event) => setChatFilter(event.target.value)} placeholder="Search this conversation…" className="mt-3 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none placeholder:text-zinc-600 focus:border-violet-400/60" /></div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">{filteredChat.length === 0 && <div className="px-4 py-10 text-center"><span className="text-2xl">💬</span><p className="mt-3 text-sm font-semibold">{chat.length ? "No matches" : "Break the silence"}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{chat.length ? "Try another search." : "Say hi, share a theory, or react to the scene."}</p></div>}{filteredChat.map((item) => <div key={item.id} className={`rounded-xl p-3 ${item.kind === "system" || item.name === "SYSTEM" ? "border border-amber-400/10 bg-amber-400/[0.035]" : "bg-white/[0.035]"}`}><div className="flex items-center justify-between gap-2"><span className={`min-w-0 truncate text-[11px] font-bold ${item.kind === "system" || item.name === "SYSTEM" ? "text-amber-200" : "text-violet-200"}`}>{item.name === "SYSTEM" ? "ROOM UPDATE" : item.name}</span><time className="shrink-0 text-[10px] text-zinc-600">{item.time}</time></div><p className="mt-1.5 break-words text-sm leading-5 text-zinc-200">{item.text}</p></div>)}<div ref={chatEndRef} /></div>
            <div className="border-t border-white/[0.07] p-3 sm:p-4"><div className="mb-3 flex flex-wrap gap-1.5">{emojis.map((emoji) => <button key={emoji} disabled={!connected} onClick={() => sendReaction(emoji)} aria-label={`Send ${emoji} reaction`} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] text-lg transition hover:border-violet-400/30 hover:bg-violet-500/10 disabled:opacity-35">{emoji}</button>)}</div><form onSubmit={sendChat} className="flex items-end gap-2"><label htmlFor="chat-message" className="sr-only">Message your friends</label><div className="min-w-0 flex-1"><textarea id="chat-message" rows={1} value={message} onChange={(event) => setMessage(event.target.value.slice(0, 500))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Message your friends…" maxLength={500} className="max-h-28 min-h-11 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none transition placeholder:text-zinc-600 focus:border-violet-400" /><p className="mt-1 text-right text-[10px] text-zinc-600">{message.length}/500 · Enter to send</p></div><button type="submit" disabled={!connected || !message.trim()} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-35">Send ↗</button></form></div>
          </aside>
        </div>
        <footer className="mt-6 flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-[11px] leading-5 text-zinc-600 sm:flex-row sm:items-center sm:justify-between"><p>Watchparty prototype · Room data is held in memory and resets when the server restarts.</p><p>Only use media links you have permission to share. Video playback depends on each browser and source.</p></footer>
      </div>
    </main>
  );
}

export type Participant = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
};

export type ChatMessage = {
  id: string;
  name: string;
  text: string;
  time: string;
  kind?: "user" | "system";
};

export type RoomSnapshot = {
  code: string;
  hostParticipantId: string;
  movieTitle: string;
  mediaUrl: string;
  isPlaying: boolean;
  position: number;
  serverNow: number;
  revision: number;
  participants: Participant[];
  messages: ChatMessage[];
  pauseVoteParticipantIds: string[];
  pauseVoteThreshold: number;
  playlist: PlaylistItem[];
  polls: GroupPoll[];
};

export type PlaylistItem = {
  id: string;
  title: string;
  mediaUrl: string;
  addedBy: string;
  addedByName: string;
  createdAt: number;
};

export type GroupPoll = {
  id: string;
  question: string;
  options: string[];
  /** Maps participant IDs to the option index they selected. */
  votes: Record<string, number>;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  isOpen: boolean;
};

export type PlaybackSnapshot = {
  code: string;
  isPlaying: boolean;
  position: number;
  serverNow: number;
  revision: number;
};

export type Ack<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type ClientToServerEvents = {
  "room:create": (
    payload: { clientId: string; name: string; movieTitle?: string },
    ack: (result: Ack<{ room: RoomSnapshot }>) => void
  ) => void;

  "room:join": (
    payload: { code: string; clientId: string; name: string },
    ack: (result: Ack<{ room: RoomSnapshot }>) => void
  ) => void;

  "room:leave": (payload: { code: string; clientId: string }) => void;

  "room:movie": (
    payload: { code: string; clientId: string; movieTitle: string }
  ) => void;

  "room:media": (
    payload: { code: string; clientId: string; mediaUrl: string },
    ack: (result: Ack<{ room: RoomSnapshot }>) => void
  ) => void;

  "playback:control": (
    payload: {
      code: string;
      clientId: string;
      action: "play" | "pause" | "seek" | "skip" | "restart" | "sync";
      position?: number;
      /** Current player state, accepted only from the room host for native YouTube controls. */
      isPlaying?: boolean;
      /** Relative seek delta in seconds; applied atomically by the server. */
      delta?: number;
      /** Optional duration lets the server reject a forward skip that would hit the end and trigger a loop. */
      duration?: number;
    }
  ) => void;

  "chat:send": (
    payload: { code: string; clientId: string; text: string }
  ) => void;

  "reaction:send": (
    payload: { code: string; clientId: string; emoji: string }
  ) => void;

  "pause-vote:toggle": (payload: { code: string; clientId: string }) => void;
  "clock:ping": (payload: { clientSentAt: number }) => void;

  "playlist:add": (payload: { code: string; clientId: string; title: string; mediaUrl: string }) => void;
  "playlist:remove": (payload: { code: string; clientId: string; itemId: string }) => void;
  "playlist:play": (payload: { code: string; clientId: string; itemId: string }) => void;

  "poll:create": (payload: { code: string; clientId: string; question: string; options: string[] }) => void;
  "poll:vote": (payload: { code: string; clientId: string; pollId: string; optionIndex: number }) => void;
  "poll:close": (payload: { code: string; clientId: string; pollId: string }) => void;

  "room:host-transfer": (payload: { code: string; clientId: string; targetParticipantId: string }, ack: (result: Ack<{ room: RoomSnapshot }>) => void) => void;
};

export type ServerToClientEvents = {
  "clock:pong": (payload: { clientSentAt: number; serverNow: number }) => void;
  "room:state": (room: RoomSnapshot) => void;
  "playback:state": (state: PlaybackSnapshot) => void;
  "chat:message": (message: ChatMessage) => void;
  "chat:system": (payload: {
    text: string;
    id: string;
    time: string;
  }) => void;
  "reaction:new": (payload: {
    emoji: string;
    name: string;
    id: string;
  }) => void;
  "pause-vote:state": (payload: { code: string; participantIds: string[]; threshold: number }) => void;
};
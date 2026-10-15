# Watch Party — Real-time Backend Milestone

This replacement adds a custom Next.js + Socket.IO server and browser client.

## Features implemented

- Server-generated 6-character room codes.
- Room existence validation and join by code.
- Live room presence and connected/reconnecting participant state.
- Host-only movie selection and shared play/pause/seek state.
- Shared chat with length limits and basic per-socket rate limits.
- Emoji reactions broadcast to room members.
- Host succession when the host's disconnect grace period expires.
- 30-second reconnect grace period based on a browser-session participant ID.
- `/healthz` health endpoint.
- Dynamic route passes the code from the Server Component to a Client Component, avoiding `useParams()` prerender/hydration issue.

## Run on Windows

```powershell
npm.cmd install
npm.cmd run dev
```

The custom server runs Next.js and Socket.IO on the same port (default 3000). For production build testing:

```powershell
npm.cmd run build
npm.cmd run start
```

The `start` script uses a server argument to select production mode, so it works in Windows PowerShell without Unix-only environment assignment.

## Architecture notes

- `server.ts`: socket events, in-memory room state, access checks, basic rate limiting.
- `lib/protocol.ts`: shared event and payload types.
- `lib/socket.ts`: singleton browser socket and stable per-session participant ID.
- `app/page.tsx`: create/join form and movie selection.
- `app/room/[code]/page.tsx`: awaits dynamic route params on the server.
- `app/room/[code]/RoomClient.tsx`: realtime room UI, chat, reactions, participants and host controls.

## Important limitations

- Room state is in memory only: server restarts clear rooms.
- This player area is a synchronized playback-state demo, not a video streaming provider.
- The single-process in-memory design is meant for a class prototype; multiple server instances require a shared adapter/state store.
- Latency and drift performance goals have not been measured.
- Security is not production-grade; add authentication or strong room access controls, persistent membership semantics, and automated tests before public use.

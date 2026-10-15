# Watch Party

A Next.js + React + Socket.IO watch-party prototype for room invites, server-authoritative playback, group chat/reactions, a shared playlist, group polls, and host handover.

## What is included

- Create and join rooms by invite URL or six-character room code.
- Host-authoritative play, pause, seek, relative skips, and end-of-video restart.
- A clock-offset estimator based on Socket.IO ping/pong, plus 250 ms drift checks and a visible approximate local-drift readout.
- Host-only YouTube native transport controls; members use the shared controls. Members have a separate fullscreen button.
- Room-wide stacked reactions with independent expiry timers and live chat.
- Shared playlist (all members can add safe links; the host can load a queued item; the author or host can remove it).
- Group polls (2–6 options, one vote per participant, live totals, creator/host can close the poll).
- Manual host transfer to a connected participant, plus automatic transfer if the host disconnects.
- Movie catalogue category/decade filters and typo-tolerant fuzzy search.
- Rate limits, validated payloads, duplicate playlist URL prevention, reconnect grace, and regression/integration tests.

## Run locally (Windows PowerShell)

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

Open http://localhost:3000. Stop the server with Ctrl+C. `npm.cmd test` now includes a 10-participant localhost playback-propagation smoke test; its output prints a p95 latency result.

## Performance measurement and caveats

See [TESTING-AND-REQUIREMENTS.md](./TESTING-AND-REQUIREMENTS.md) for the club-rubric traceability matrix, the measured fields, the exact limits, how to repeat the tests, and how to record a separate-machine LAN test.

The automated test measures Socket.IO control-event delivery under ten connected participants inside one Node process on loopback. It is a reproducible smoke benchmark, not proof of the club's separate-machine LAN p95 requirement. It does not measure browser rendering, decoding, YouTube buffering, or display latency. The app's drift readout is an estimate from the room clock and local player time; the 500 ms drift requirement still needs paired-browser verification on the actual network/video source.

## Media-source limitations

Supported: YouTube videos that permit embedding and direct browser-playable HTTP(S) media files (normally MP4/WebM). A general webpage URL is not necessarily a media file. Amazon Prime Video and other protected streaming-service pages are not supported by this player, and the app does not bypass DRM, paywalls, subscriptions, or provider access restrictions.

YouTube selects playback quality adaptively for each viewer; the IFrame Player API does not provide a supported way to force all viewers to the same resolution/FPS. The app synchronizes playback intent and position as closely as the source and network permit, not identical quality or identical frames.

## Storage and deployment

Room state is in memory. It resets when the server restarts or when a room empties, and a single server process is assumed. For deployment across multiple app instances, use shared storage plus a Socket.IO adapter and define a production persistence/expiry policy; this prototype does not yet implement those.

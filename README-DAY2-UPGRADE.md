# Watchparty — Day 2 Upgrade Batch

This is an **overlay** for the existing `watch-party` project, not a brand-new app. It keeps the Next.js + React + Socket.IO stack and adds the following coordinated improvements:

## Included in this batch

1. **Room presence hardening** — a socket cannot accidentally keep a stale membership if its browser-session identity or room changes; client room snapshots remain authoritative and chat history is merged by message ID rather than overwritten.
2. **Real browser video playback** — hosts can load the included public sample clip or share a direct HTTP(S) video URL. Play, pause and seek changes are broadcast through the existing server state. Guests receive the same media URL and synchronized state.
3. **Room UX upgrade** — connection/presence indicators, 25-person capacity display, host badge, invite/code copy, shared source controls, playable video, autoplay recovery, live reactions, searchable chat and mobile-friendly layout.
4. **Home UX upgrade** — more film cards, category filters, title/genre search, better empty states, and clearer distinction between a film title and the actual video source.
5. **Automated verification** — validation unit tests and a Socket.IO integration test that launches the custom server, creates a room, verifies both host and guest remain in the room snapshot, checks chat/playback broadcasts, and confirms unsafe source schemes are rejected.

## Apply on Windows

1. Stop the current server in the terminal with `Ctrl+C`.
2. Make a backup or create a Git commit before overwriting files.
3. Extract this ZIP **into the existing `watch-party` project root**. The ZIP paths start with `app`, `lib`, `tests`, and `server.ts`.
4. When prompted, choose **Replace files in the destination** for matching files. Do not delete the project folder.
5. Open a terminal in the project root and run:

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Open `http://localhost:3000`; `/healthz` should return JSON while the server is running.

## Manual two-window smoke test

1. Create a room in a normal browser window.
2. Open an Incognito window, use the code to join, and check that both names appear in **People in this room** in both windows.
3. Send chat from the guest; confirm it appears in both windows.
4. From the host, click **Load sample video**, then **Play**, **Pause**, and seek. Check that the guest video follows the host's commands.
5. Try a non-video or unsupported URL. The interface will show a source error; a browser-playable direct video URL is required.
6. Close/reload one window and verify the participant briefly appears as reconnecting; after the grace period, the entry is removed.

## Source URL notes

- A YouTube watch-page URL is not a direct HTML `<video>` source. Use a direct MP4/WebM URL accessible to all participants, and only content you have permission to share.
- Browsers may block autoplay on a guest device until that person taps **Enable playback**.
- The sample clip is only test footage; selecting a film title on the homepage labels the room but does not provide that film's video.

## Still prototype limitations

- Rooms and chat history are stored in server memory and are lost when the server restarts or the room empties.
- The project does not host videos, bypass DRM, or connect to a licensed streaming provider.
- It runs as one Node process; scaling to multiple server instances needs shared state/Socket.IO adapter support.
- Automated tests are smoke/integration tests, not a complete security, load, cross-browser, or latency test suite.

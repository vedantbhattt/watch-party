# Watch Party — Playback Sync Upgrade

This upgrade updates the existing project rather than replacing the app architecture.

## Changes included

1. **Authoritative playback events:** the room client now subscribes to `playback:state` and applies play, pause, and seek updates immediately, while keeping full room snapshots as the source of truth for room details.
2. **Continuous drift correction:** direct video and YouTube playback are checked while playing and while paused. The client seeks back to the server's target when drift crosses a small tolerance and restores the expected playing/paused state when browser policy allows it.
3. **Host-only YouTube interaction:** the YouTube iframe is non-interactive and keyboard controls remain disabled, so guests cannot change playback by clicking the embedded player. The app's visible playback buttons remain the control surface.
4. **Autoplay-unlock handling:** when a browser blocks a remote play command, the guest can click **Enable playback** to resume the host's already-active shared playback at the current server-clock position. That local gesture does not send a play/pause/seek command to the room.
5. **Authorization regression test:** the real-time integration test now checks that a guest's forged pause and seek events cannot pause or jump the shared room.

## How to apply

1. Stop the development server in the terminal with `Ctrl+C`.
2. Make a backup of your current `watch-party` folder.
3. Extract this ZIP into a new folder, or copy the files from this upgraded project over the matching files in your existing project. Keep your `.env` file, if you have one; this ZIP intentionally does not include secrets.
4. In the project folder, run:

   ```powershell
   npm.cmd ci
   npm.cmd run typecheck
   npm.cmd test
   npm.cmd run build
   npm.cmd run dev
   ```

## Manual playback check

- Open the room in the normal browser as host, and the same room in an Incognito window as guest.
- Load a YouTube link that permits embedding.
- As host, press **Play**, then **Pause**, then **Play** again. The guest should follow the room state and the same approximate timestamp.
- Try clicking the embedded YouTube video in the guest window. It should not directly pause or start the player.
- If the guest browser blocks autoplay after the host presses Play, use **Enable playback**. This should resume the current shared state without changing what the host controls.
- As host, seek with the range control or the ±10-second buttons. The guest should be corrected back toward the shared timestamp within a couple of seconds.
- Repeat with **Load sample video** to verify the direct MP4/WebM path independently of YouTube.

## Important limitation

YouTube and browser autoplay rules can still require one local click per guest browser. The upgrade keeps that click separate from room control. Some YouTube videos also prohibit embedding, and no client-side code can override that restriction.

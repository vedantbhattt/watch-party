WATCH PARTY - YOUTUBE INITIAL PLAYBACK SYNC FIX

What this changes
-----------------
The YouTube drift-correction loop no longer treats BUFFERING by itself as a manual seek.
During the first Play, YouTube can report an old timestamp while it buffers. The old logic
could publish that stale time as the room's new authoritative position and keep resetting
the shared clock. The fix only treats a real observed timestamp jump as a native host seek.

Apply the fix (Windows)
-----------------------
1. Stop the dev server in the terminal with Ctrl+C.
2. Keep a backup of your current file:
   app\room\[code]\RoomClient.tsx
3. Extract this ZIP.
4. Copy the included file:
   app\room\[code]\RoomClient.tsx
   into your project's matching folder, overwriting the old file.
   Do not copy the whole folder over your project and do not delete node_modules.
5. In the project root, run:
   npm.cmd run typecheck
   npm.cmd test
   npm.cmd run dev
6. Test in the host browser and an Incognito guest window:
   - Load/share the YouTube video and wait until it appears on both screens.
   - Click the purple Play button once on the host.
   - Do not click -10s during the first test. Check whether both screens start near the
     same position and self-correct if one player buffers.

Note
----
This patch changes only the client playback-sync logic. It cannot bypass YouTube embed
restrictions or browser autoplay restrictions. If a guest browser blocks playback, that
browser may still need a local click to allow playback.

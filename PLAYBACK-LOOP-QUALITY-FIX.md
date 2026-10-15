# Watch Party: playback, pause votes, reactions, and YouTube format fixes

## Included

- Canonicalize YouTube watch, Shorts, live, embed, and short URLs to one `watch?v=...` URL and always render the embedded player in the room's fixed 16:9 viewport. The source video's own portrait aspect ratio remains portrait content; YouTube does not offer a way to turn a vertical video into a true landscape video.
- Keep YouTube native controls host-only; members cannot click their embedded player. Shared controls remain the supported room controls.
- Tighten periodic YouTube drift correction to reduce accumulated mismatch after pause/resume.
- Ignore a forward skip when the host's known duration says it would hit the end. This avoids a seek-to-ended event accidentally racing with loop restart.
- Add a room-wide pause vote. Every connected participant may vote; a majority threshold is used, with at least two votes required. A successful vote pauses the shared playback state.
- Queue simultaneous reactions as separate stacked bubbles with independent expiry timers.
- Add regression tests for canonical YouTube URLs, end-overshooting skips, and pause votes.

## Important YouTube quality limitation

The official YouTube IFrame Player API no longer supports forcing or reading the playback quality through `setPlaybackQuality`/`getPlaybackQuality`; YouTube selects quality adaptively for each viewer based on local conditions. Therefore the app cannot guarantee that guests receive the exact same resolution or FPS as the host, especially while guest native controls are hidden. See the official API revision history: https://developers.google.com/youtube/iframe_api_revision_history

If exact same quality is a hard requirement, use a single shared direct video file and identical player settings across clients instead of YouTube's adaptive streaming.

## Apply on Windows

1. Stop the development server with Ctrl+C.
2. Keep the backup folder untouched.
3. Extract this ZIP into the existing `watch-party` project root, replacing matching files. Do not delete `node_modules`.
4. Run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`, one at a time.
5. Start with `npm.cmd run dev`. Test with host and guest browsers.

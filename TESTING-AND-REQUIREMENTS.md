# Club requirements and verification plan

Date of source review: 2026-10-14. Status below distinguishes implemented behavior from behavior actually measured. Passing code tests alone does not prove a browser or network performance target.

## Requirement traceability

| Club requirement | Implementation in this source | Verification / caveat |
|---|---|---|
| Create/join via invite URL or room code | Homepage creates a room or joins a normalized six-character code; room has share/copy invite | `tests/realtime.test.ts` covers create/join; also try a normal browser plus Incognito manually |
| Sync play, pause and seek | Authoritative in-memory server clock; host command authorization; relative skip applied at server; clients correct HTML/YouTube players | Integration tests cover shared state, guest command rejection, rapid skips, restart; separate browser/source testing still required |
| Movie recommendations, categories, filters, fuzzy search | Local curated recommendation catalogue; genre buttons; decade filter; typo-tolerant fuzzy matching in `lib/search.ts` | `tests/search.test.ts` covers fuzzy matches/typos; catalogue is intentionally static, not a live movie-provider API |
| Emoji reactions | Reactions are broadcast with IDs and separate per-reaction expiry timers | Existing room UI/server path; manually send several reactions at once to check stacking |
| Live chat | Socket.IO room broadcast, bounded message length, per-socket rate limit | Existing room integration test covers chat broadcast |
| Shared playlists | Members add a validated HTTP(S)/YouTube link; room snapshot carries the ordered queue; host loads items; author/host can remove items | `tests/realtime.test.ts` covers add and host load; manually check updates in two browsers |
| Group polls | Any connected member can create a poll with 2–6 distinct options; one current vote per participant; live tallies; creator or host can close | `tests/realtime.test.ts` covers create/vote/close; manually confirm simultaneous voters see the same tally |
| Host transfer | Current host can transfer to another connected room member; stale/former host request is rejected; automatic fallback remains for a disconnected host | `tests/realtime.test.ts` covers accepted transfer and former-host rejection |
| Automatic drift detection/correction | Clock offset is estimated using periodic ping/pong; client player positions are compared against the room target every 250 ms and corrected when drift exceeds about 400 ms during playback | Local drift estimate is visible in the room; the 500 ms condition must be tested in both browsers over the target network and the chosen source |
| Late joins/reconnects/concurrent actions | Joining receives current room snapshot; room state/revisions reconcile updates; reconnect grace is 30 seconds; playback relative skips are applied atomically | Integration tests cover joining, replacement/recovery identity and rapid skips; repeat disconnect/reconnect during active playback manually |
| At least 10 users per room | Server room capacity is 25; automated test connects host + guest + eight additional participants | Regression test asserts ten participants can join and receive playback events; larger-scale and real browser resource use is not measured |
| Playback-control propagation <=250 ms at p95 on a local network | Test measures command emission-to-client-event receipt for 20 playback commands and nine remote sockets (180 latency samples), and prints p95 | Assertion checks p95 <=250 ms on loopback. This is only a localhost smoke benchmark; repeat from separate machines on the actual LAN and record those measurements for the club |
| Playback drift <=500 ms after correction | Client estimator corrects when estimated player drift crosses ~400 ms while playing | Not declared proven by the Node integration suite; record paired-browser drift before/after correction using the visible readout and a synchronized direct MP4/WebM source as well as YouTube |
| Document latency conditions and failure handling | This file documents the local test conditions, network test, autoplay/source failures, reconnect behavior, and known limitations | Fill in the result table below after testing on the actual LAN |

## Automated latency smoke-test conditions

- Process: one `server.ts` child process, started by `tests/realtime.test.ts` on a free loopback port.
- Clients: ten Socket.IO websocket clients total (one host, one guest, eight additional participants).
- Actions: 20 sequential Play/Pause control events from the host.
- Samples: event receive time minus command emission time across the nine non-host sockets (up to 180 samples).
- Metric: nearest-rank p95, calculated by sorting samples and selecting the `ceil(0.95 * n) - 1` index.
- Test limit: p95 <=250 ms; the test log prints `[performance-smoke] users=10 samples=... playback-control-p95=...ms`.
- Scope: this measures server/socket event propagation inside one process over loopback; it does not measure separate-machine LAN latency, browser paint, media decoding, adaptive buffering, or the actual video frame reaching the screen.

## Separate-machine LAN test to complete before claiming the rubric targets

1. Start the server on the host machine and make it reachable on the private LAN. On the development server, bind to the host's LAN address or use the relevant development host option; only do this on a trusted private network.
2. Open the same invite link from multiple browser devices/tabs. Include at least ten connected participants if the network allows it. Do not count disconnected room entries as active users.
3. Run at least 100 play/pause/seek actions, including repeated toggles and seeks while other members join/reconnect. Capture command timestamps and event arrival timestamps on remote clients.
4. Report p50, p95, and max command propagation. The required p95 is <=250 ms; repeat under expected Wi-Fi congestion.
5. Use a direct MP4/WebM clip for predictable playback, and repeat with an embeddable YouTube clip. Record estimated player drift immediately after a command and after the 250 ms correction loop has had time to act. The required drift after correction is <=500 ms.
6. Repeat with one client temporarily offline, a late join, and a reconnect within 30 seconds. Note whether autoplay must be unlocked by a user gesture and whether the player source supports seeking.

### LAN result table (fill in with measurements; no results have been claimed here)

| Date / topology | Source | Active participants | Control samples | p95 control propagation | Max observed drift after correction | Failures / notes |
|---|---|---:|---:|---:|---:|---|
| Pending real LAN run | Direct MP4/WebM | 10+ | Pending | Pending | Pending | Pending |
| Pending real LAN run | Embeddable YouTube | 10+ | Pending | Pending | Pending | Pending |

## Failure handling and known limitations

- Room creation/join and host transfer use acknowledgements so the UI can show failed/timed-out requests.
- Invalid URLs and unsupported media schemes are rejected. A valid URL may still be a webpage rather than a direct playable media file; browser `error` events provide an explanation and Retry is available.
- Some YouTube videos disable embedding or require access the embedded player cannot establish. Paid/provider-protected sources are not supported and are never bypassed.
- Autoplay restrictions are per browser; a member may need to click the local “Enable playback” prompt. That local gesture does not broadcast a play command.
- A disconnected participant remains in the room for up to 30 seconds and can reconnect; after grace expiry they are removed. If the host is removed, the first connected member is promoted automatically.
- Room, playlist and poll data are memory-only and reset on process restart. Multi-instance production deployment needs shared state and a Socket.IO adapter.
- YouTube chooses quality adaptively per viewer. Same resolution/FPS cannot be guaranteed.

# Watch Party upgrade — verification report

Date: 2026-10-14

## Changes included

- Shared room playlist: validate links, add/remove queue entries, and let the host load an item.
- Group polls with 2–6 unique options, participant votes, live totals, and close controls.
- Manual host transfer plus automatic host fallback; includes an edge-case fix when a participant joins while the prior host is offline.
- Typo-tolerant movie catalogue search and decade filtering.
- Guest fullscreen while keeping YouTube native controls hidden for guests.
- Pause request is hidden from the host in the UI and rejected by the server if emitted by the host.
- Server/client clock offset estimation and more frequent drift correction.
- Updated integration coverage for playlist, polls, transfer/reconnect, ten concurrent Socket.IO participants, and a localhost p95 control-propagation smoke benchmark.

## Verification performed in the preparation environment

| Check | Result | Scope |
|---|---|---|
| TypeScript/TSX syntax parse | PASS — 13 files parsed with no syntax diagnostics | Syntax only; not a full project typecheck |
| Strict TypeScript check for `lib/protocol.ts`, `lib/validation.ts`, `lib/search.ts` | PASS | Those dependency-light modules only |
| Isolated Node tests for validation + fuzzy search | PASS — 7 passed, 0 failed | Does not include the Socket.IO integration test |
| Full `npm.cmd run typecheck` | NOT RUN successfully here | A usable complete dependency install was unavailable in the preparation environment |
| Full `npm.cmd test` including the realtime integration / 10-user smoke benchmark | NOT RUN successfully here | Requires the project's installed runtime dependencies |
| `npm.cmd run build` | NOT RUN successfully here | Requires a complete Next.js dependency install |
| Browser-in-two-tabs/device test | NOT RUN | Must be verified in the actual project browser |
| Separate-machine LAN p95 / media drift | NOT MEASURED | Must be recorded on the target LAN; localhost is not proof of LAN performance |

## Required local verification

From the Windows project root, run these commands one at a time:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The realtime integration test prints a `[performance-smoke]` line with ten connected participants and localhost p95 event-delivery latency. It asserts the smoke-test p95 is at most 250 ms. If this assertion is noisy on a busy computer, save the complete output rather than weakening the assertion without examining it.

Then manually test a host window plus an Incognito guest. Check play/pause/seek, guest fullscreen and hidden YouTube controls, member-only pause voting, reactions, shared playlist, polls, host handover, and reconnect.

## Important limitations

- The performance smoke test runs clients on loopback in one process. It does not prove the 250 ms p95 target across separate devices on the actual LAN or measure the frame actually displayed by the browser.
- The 500 ms corrected-drift target must be measured in two browser sessions using actual playback sources. The visible client drift is an estimate, not a frame-level measurement.
- YouTube chooses video quality adaptively per viewer. Identical resolution/FPS cannot be guaranteed.
- Paid streaming subscriptions or DRM permissions are not shared between users and are not bypassed.
- Room, playlist, and poll state is in memory and resets when the server restarts. Persistent storage and multi-instance deployment remain separate work.

# Watch Party playback fixes — current status

This note is superseded by `PLAYBACK-LOOP-QUALITY-FIX.md` and `README.md` in the current project bundle. The current bundle includes relative server-side skips, host-only native YouTube controls, host native-playback synchronization, guarded end-of-video restart behavior, and tests for the newer playback paths.

The YouTube trade-off is intentional: guests cannot click the embedded YouTube player or use its native Quality menu. The supported YouTube embed parameters do not offer a separate Quality-only control bar; allowing native player controls to guests also allows local-only play/pause/seek. Use the shared controls beneath the player for room synchronization.

After copying the current bundle over your project, run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` from the project root.

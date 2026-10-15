# Watch Party

<p align="center">
  <img src="./public/watch-party-banner.svg" alt="Watch Party — Watch together. Stay in sync." width="100%" />
</p>

<p align="center">
  <strong>Same movie. Same moment. Different places.</strong><br />
  A real-time watch-party app for watching together, chatting live, and sharing reactions from anywhere.
</p>

<p align="center">
  <a href="https://watch-party-red-seven.vercel.app/"><strong>🚀 Live Demo</strong></a> ·
  <a href="https://github.com/vedantbhattt/watch-party"><strong>📂 Source Code</strong></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white" />
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white" />
</p>

---

## 🎬 Overview

Watch Party brings friends together in a shared virtual movie room. Create a room, invite friends using a link or room code, synchronize playback, and interact in real time.

Whether you're watching across the room or across the world, the goal is simple: **watch together, stay in sync.**

## ✨ Features

| Feature | Description |
|---|---|
| 🏠 Rooms & Invites | Create or join rooms using an invite URL or six-character room code |
| ▶️ Synchronized Playback | Shared play, pause, seek, relative skips, and restart controls |
| 🎯 Drift Correction | Clock-offset estimation and periodic playback-position checks |
| 💬 Live Chat | Chat with everyone in the room |
| 🎉 Emoji Reactions | Send temporary reactions during the movie |
| 📃 Shared Playlist | Add supported media links and manage queued videos |
| 📊 Group Polls | Create polls, vote live, and view results |
| 👑 Host Management | Transfer host privileges and handle participant disconnects |
| 🎞️ Movie Discovery | Browse a curated catalogue with category and decade filters |
| 🛡️ Validation & Resilience | Validated payloads, rate limits, reconnect grace, and duplicate URL prevention |

## 🛠️ Tech Stack

- **Frontend:** Next.js, React, TypeScript
- **Real-time communication:** Socket.IO
- **Styling:** Tailwind CSS
- **Quality checks:** ESLint, TypeScript, Node.js test runner via `tsx`

See [`package.json`](./package.json) for dependency versions and available scripts.

## 🚀 Run Locally

### Prerequisites

- Node.js compatible with the project dependencies
- npm

### Installation

**Windows PowerShell**

```powershell
npm.cmd ci
npm.cmd run dev
```

**macOS / Linux**

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Quality Checks

Run these commands from the repository root:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Or run the combined lint, type-check, and test suite:

```bash
npm run check
```

## ⚙️ How It Works

1. A participant creates a room or joins through an invite link or room code.
2. The server maintains room state and validates incoming actions.
3. Socket.IO broadcasts accepted state changes to connected participants.
4. Clients synchronize player positions against the shared room clock and correct estimated playback drift.
5. Chat, reactions, playlists, polls, and host transfers are handled through real-time events.

### Architecture

```text
Browser Clients
      |
      | Socket.IO Events
      v
TypeScript Server (server.ts)
      |
      +-- Room and Playback State
      +-- Validation and Host Permissions
      +-- Chat, Reactions, Playlists and Polls
      |
      v
Connected Room Participants
```

## 🎥 Media Support & Limitations

- Supports embeddable YouTube videos and direct browser-playable HTTP(S) media files, typically MP4 or WebM.
- Ordinary webpage URLs are not necessarily playable media sources.
- DRM-protected streaming content is not supported.
- YouTube selects playback quality separately for each viewer; identical resolution, FPS, or displayed frames cannot be guaranteed.
- Browser autoplay policies may require user interaction before playback starts.
- Room state is held in memory and resets when the server restarts or a room empties. Multi-instance deployment would require shared state and a Socket.IO adapter.

## 🧪 Testing & Verification

Automated tests cover important validation, search, and real-time server behavior. The playback smoke test measures control-event propagation among ten Socket.IO clients connected to a single local server process.

**Important:** Local event-propagation measurements do not establish end-to-end video-frame synchronization or performance across separate devices. The 250 ms control-propagation and 500 ms post-correction drift targets require separate browser/device verification before they can be claimed as demonstrated.

See [Testing & Requirements](./TESTING-AND-REQUIREMENTS.md) for the requirement traceability matrix, test scope, LAN test procedure, and pending measurements.

## 📚 Documentation

- [Testing & Requirements](./TESTING-AND-REQUIREMENTS.md) — requirements, test coverage, and LAN verification
- [Verification Report](./VERIFICATION-REPORT.md) — verification notes
- [Playback Sync Upgrade](./PLAYBACK-SYNC-UPGRADE.md) — synchronization design
- [Playback Loop Quality Fix](./PLAYBACK-LOOP-QUALITY-FIX.md) — playback quality notes
- [Rapid Skip Fix](./PLAYBACK-RAPID-SKIP-FIX.md) — relative-skip handling

## 🤝 Contributing

Issues and focused pull requests are welcome. Before submitting changes, run `npm run check` and `npm run build`, and document any manual browser or multi-device tests performed.

## 📄 License

No license is currently specified. Permission to reuse, modify, or redistribute this project should not be assumed unless a license is added.# Watch Party

<p align="center">
  <img src="./public/watch-party-banner.svg" alt="Watch Party — Watch together. Stay in sync." width="100%" />
</p>

<p align="center">
  <strong>Same movie. Same moment. Different places.</strong><br />
  A real-time watch-party app for watching together, chatting live, and sharing reactions from anywhere.
</p>

<p align="center">
  <a href="https://watch-party-red-seven.vercel.app/"><strong>🚀 Live Demo</strong></a> ·
  <a href="https://github.com/vedantbhattt/watch-party"><strong>📂 Source Code</strong></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white" />
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white" />
</p>

---

## 🎬 Overview

Watch Party brings friends together in a shared virtual movie room. Create a room, invite friends using a link or room code, synchronize playback, and interact in real time.

Whether you're watching across the room or across the world, the goal is simple: **watch together, stay in sync.**

## ✨ Features

| Feature | Description |
|---|---|
| 🏠 Rooms & Invites | Create or join rooms using an invite URL or six-character room code |
| ▶️ Synchronized Playback | Shared play, pause, seek, relative skips, and restart controls |
| 🎯 Drift Correction | Clock-offset estimation and periodic playback-position checks |
| 💬 Live Chat | Chat with everyone in the room |
| 🎉 Emoji Reactions | Send temporary reactions during the movie |
| 📃 Shared Playlist | Add supported media links and manage queued videos |
| 📊 Group Polls | Create polls, vote live, and view results |
| 👑 Host Management | Transfer host privileges and handle participant disconnects |
| 🎞️ Movie Discovery | Browse a curated catalogue with category and decade filters |
| 🛡️ Validation & Resilience | Validated payloads, rate limits, reconnect grace, and duplicate URL prevention |

## 🛠️ Tech Stack

- **Frontend:** Next.js, React, TypeScript
- **Real-time communication:** Socket.IO
- **Styling:** Tailwind CSS
- **Quality checks:** ESLint, TypeScript, Node.js test runner via `tsx`

See [`package.json`](./package.json) for dependency versions and available scripts.

## 🚀 Run Locally

### Prerequisites

- Node.js compatible with the project dependencies
- npm

### Installation

**Windows PowerShell**

```powershell
npm.cmd ci
npm.cmd run dev
```

**macOS / Linux**

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Quality Checks

Run these commands from the repository root:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Or run the combined lint, type-check, and test suite:

```bash
npm run check
```

## ⚙️ How It Works

1. A participant creates a room or joins through an invite link or room code.
2. The server maintains room state and validates incoming actions.
3. Socket.IO broadcasts accepted state changes to connected participants.
4. Clients synchronize player positions against the shared room clock and correct estimated playback drift.
5. Chat, reactions, playlists, polls, and host transfers are handled through real-time events.

### Architecture

```text
Browser Clients
      |
      | Socket.IO Events
      v
TypeScript Server (server.ts)
      |
      +-- Room and Playback State
      +-- Validation and Host Permissions
      +-- Chat, Reactions, Playlists and Polls
      |
      v
Connected Room Participants
```

## 🎥 Media Support & Limitations

- Supports embeddable YouTube videos and direct browser-playable HTTP(S) media files, typically MP4 or WebM.
- Ordinary webpage URLs are not necessarily playable media sources.
- DRM-protected streaming content is not supported.
- YouTube selects playback quality separately for each viewer; identical resolution, FPS, or displayed frames cannot be guaranteed.
- Browser autoplay policies may require user interaction before playback starts.
- Room state is held in memory and resets when the server restarts or a room empties. Multi-instance deployment would require shared state and a Socket.IO adapter.

## 🧪 Testing & Verification

Automated tests cover important validation, search, and real-time server behavior. The playback smoke test measures control-event propagation among ten Socket.IO clients connected to a single local server process.

**Important:** Local event-propagation measurements do not establish end-to-end video-frame synchronization or performance across separate devices. The 250 ms control-propagation and 500 ms post-correction drift targets require separate browser/device verification before they can be claimed as demonstrated.

See [Testing & Requirements](./TESTING-AND-REQUIREMENTS.md) for the requirement traceability matrix, test scope, LAN test procedure, and pending measurements.

## 📚 Documentation

- [Testing & Requirements](./TESTING-AND-REQUIREMENTS.md) — requirements, test coverage, and LAN verification
- [Verification Report](./VERIFICATION-REPORT.md) — verification notes
- [Playback Sync Upgrade](./PLAYBACK-SYNC-UPGRADE.md) — synchronization design
- [Playback Loop Quality Fix](./PLAYBACK-LOOP-QUALITY-FIX.md) — playback quality notes
- [Rapid Skip Fix](./PLAYBACK-RAPID-SKIP-FIX.md) — relative-skip handling

## 🤝 Contributing

Issues and focused pull requests are welcome. Before submitting changes, run `npm run check` and `npm run build`, and document any manual browser or multi-device tests performed.

## 📄 License

No license is currently specified. Permission to reuse, modify, or redistribute this project should not be assumed unless a license is added.

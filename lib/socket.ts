"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let volatileClientId: string | null = null;

function newClientId() {
  return typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `wp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSocket() {
  if (!socket) {
    // Prefer an explicit deployment setting. The production fallback keeps the
    // hosted demo working even if Vercel environment-variable access is unavailable.
    // Local development still uses the same-origin custom server.
    const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
    const serverUrl = configuredUrl || (
      process.env.NODE_ENV === "production"
        ? "https://watch-party-server-m942.onrender.com"
        : undefined
    );

    socket = io(serverUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 8000,
    });
  }
  return socket;
}

/**
 * Return a stable identity for this browser tab/session. The in-memory fallback
 * matters when sessionStorage is blocked: both the home page and room page must
 * still resolve to the same participant ID during client-side navigation.
 */
export function getClientId() {
  if (typeof window === "undefined") return "";
  if (volatileClientId) return volatileClientId;

  const key = "watch-party-client-id";
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored) return stored;
    const created = newClientId();
    try {
      window.sessionStorage.setItem(key, created);
      return created;
    } catch {
      volatileClientId = created;
      return volatileClientId;
    }
  } catch {
    volatileClientId = newClientId();
    return volatileClientId;
  }
}

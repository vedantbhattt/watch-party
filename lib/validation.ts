/** Shared client/server validation helpers for user-controlled room and media input. */
export function normalizeDisplayName(value: unknown, fallback = "Guest"): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 24);
  return clean || fallback;
}

export function normalizeRoomCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{6}$/.test(value);
}

/**
 * Accept any safe HTTP(S) URL. The room UI supports YouTube watch/share/embed URLs
 * via the YouTube IFrame API, plus direct browser-playable media URLs such as MP4/WebM.
 * Generic URLs still need to point to media the browser can actually play.
 */
export function normalizeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (input === "") return ""; // An empty value explicitly clears the current media.
  if (input.length > 2048) return null;

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const isYouTubeHost = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host);
    if (isYouTubeHost) {
      const videoId = getYouTubeVideoId(parsed.toString());
      if (!videoId) return null;
      // Canonicalize watch, shorts, live, embed and youtu.be links to one URL.
      // The room always embeds the same standard player in a fixed 16:9 viewport.
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Returns the 11-character ID for common YouTube URL forms, or null for non-YouTube URLs. */
export function getYouTubeVideoId(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const supportedHosts = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"]);
    if (!supportedHosts.has(host)) return null;

    let id: string | null = null;
    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else {
      id = url.searchParams.get("v");
      if (!id) {
        const parts = url.pathname.split("/").filter(Boolean);
        const marker = parts.findIndex((part) => ["embed", "shorts", "live", "v"].includes(part.toLowerCase()));
        if (marker >= 0) id = parts[marker + 1] ?? null;
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function clampPosition(value: unknown, maxSeconds = 24 * 60 * 60): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(0, Math.min(maxSeconds, numberValue));
}

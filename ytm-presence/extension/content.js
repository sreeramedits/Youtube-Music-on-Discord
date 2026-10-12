// Runs on music.youtube.com. Reads what's playing and reports changes.
// Only sends when something changes (track, play/pause, seek) so Discord's
// rate limit on activity updates is never a problem.

const POLL_MS = 1000;
let last = null; // last state we reported

function getArtwork(meta) {
  if (!meta || !meta.artwork || !meta.artwork.length) return null;
  // Pick the largest artwork available.
  const best = meta.artwork
    .slice()
    .sort((a, b) => parseInt(b.sizes, 10) - parseInt(a.sizes, 10))[0];
  return best && best.src && best.src.startsWith("https://") ? best.src : null;
}

function readState() {
  const video = document.querySelector("video");
  const meta = navigator.mediaSession && navigator.mediaSession.metadata;
  if (!video || !meta || !meta.title) return null;
  if (!isFinite(video.duration) || video.duration <= 0) return null;

  return {
    title: meta.title,
    artist: meta.artist || "",
    album: meta.album || "",
    artwork: getArtwork(meta),
    url: location.origin + "/watch?v=" + (new URLSearchParams(location.search).get("v") || ""),
    position: video.currentTime,
    duration: video.duration,
    paused: video.paused,
  };
}

function changed(prev, cur) {
  if (!prev) return true;
  if (prev.title !== cur.title || prev.artist !== cur.artist) return true;
  if (prev.paused !== cur.paused) return true;
  // Detect seeks: position should advance ~1s per second while playing.
  const now = Date.now();
  const expected = prev.position + (prev.paused ? 0 : (now - prev.at) / 1000);
  return Math.abs(cur.position - expected) > 2.5;
}

function send(state) {
  try {
    chrome.runtime.sendMessage({ type: "presence", state });
  } catch (_) {
    // Extension was reloaded; the old content script can't talk anymore.
  }
}

const HEARTBEAT_MS = 10000;
let lastSentAt = 0;

setInterval(() => {
  const cur = readState();
  if (!cur) {
    if (last) {
      send(null);
      last = null;
    }
    return;
  }
  const now = Date.now();
  if (changed(last, cur)) {
    send(cur);
    lastSentAt = now;
  } else if (now - lastSentAt > HEARTBEAT_MS) {
    // Tells the local script the browser is still alive (it clears the status
    // if it hears nothing for 30s, e.g. after a browser crash).
    send({ heartbeat: true });
    lastSentAt = now;
  }
  last = { ...cur, at: now };
}, POLL_MS);

window.addEventListener("pagehide", () => send(null));

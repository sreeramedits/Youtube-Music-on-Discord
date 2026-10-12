// Relays messages from the YouTube Music tab to the local script.
// The local script only listens on 127.0.0.1, so nothing leaves your computer
// except the Discord status itself.

const ENDPOINT = "http://127.0.0.1:3535/presence";

chrome.runtime.onMessage.addListener((msg, sender) => {
  // Only accept messages from our own content script on music.youtube.com.
  if (!msg || msg.type !== "presence") return;
  if (!sender.url || !sender.url.startsWith("https://music.youtube.com/")) return;

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.state),
  }).catch(() => {
    // Local script isn't running; ignore.
  });
});

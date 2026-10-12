# YTM Discord Presence

Show what you're playing on **YouTube Music** (in your browser) as a Spotify-style **"Listening to"** status on your Discord profile, with album art, title, artist and a progress bar.

Discord has no built-in YouTube Music support. This project fills that gap with two tiny parts and **no dependencies, no accounts, no tracking**:

- **`extension/`**: a Chrome/Edge extension that runs only on `music.youtube.com` and reads the current song.
- **`server.js`**: a Node.js script that receives it on `127.0.0.1` and sets your Discord status through Discord's local Rich Presence IPC.

```
YouTube Music tab  ->  extension  ->  http://127.0.0.1:3535  ->  server.js  ->  Discord app
```

## Requirements

- Chrome, Edge, or another Chromium browser (Safari/Firefox are not supported)
- [Node.js](https://nodejs.org) 18 or newer
- The **Discord desktop app** (the web version can't receive Rich Presence)
- macOS, Windows, or Linux

## Setup (one time)

### 1. Create a Discord application
1. Go to https://discord.com/developers/applications and click **New Application**.
2. Name it **YouTube Music**. This name is what appears as "Listening to YouTube Music".
3. On the **General Information** page, copy the **Application ID** (a number of about 18 digits). It's a public identifier, not a secret.

### 2. Download the project
```bash
git clone https://github.com/YOUR_USERNAME/ytm-discord-presence.git
cd ytm-discord-presence
```
(Or download the ZIP from GitHub and unzip it.)

### 3. Add your Application ID
Create `config.json` in the project folder. Copy `config.example.json` and replace the placeholder:

```bash
cp config.example.json config.json
```
```json
{
  "clientId": "123456789012345678"
}
```

Or skip the file and pass it on the command line: `node server.js 123456789012345678`.
`config.json` is in `.gitignore`, so it won't be committed.

### 4. Load the extension
1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

## Usage

1. Open the Discord desktop app.
2. In the project folder, run:
   ```bash
   node server.js
   ```
   (or `npm start`). You should see `YTM Discord Presence running...`. Leave this window open.
3. Open https://music.youtube.com and play a song. Within a couple of seconds your Discord profile shows it.
4. Press **Ctrl+C** to stop. This also clears your status.

Make sure Discord's **Settings > Activity Privacy > Share my detected activity** is on.

## Behavior

- The status updates on track change, play/pause and seeking.
- It clears when you pause, close the tab, stop the script, or if the browser stops reporting for 30 seconds.
- Other people see a **Listen on YouTube Music** button; you won't see it on your own profile.
- Discord's "Listen along" is Spotify-only and can't be replicated.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Missing or invalid Discord Application ID` | `config.json` is missing, in the wrong folder, still has the placeholder, or has curly quotes. Run `cat config.json` to check, or use `node server.js YOUR_ID`. |
| Terminal shows nothing when a song plays | Reload the extension on `chrome://extensions`, then refresh the YouTube Music tab. Check the extension for errors. |
| `Discord desktop app not found` | Open the Discord desktop app. The script retries every few seconds. |
| Status doesn't appear on profile | Enable Activity Privacy > Share my detected activity in Discord. |
| Album art missing | Discord may decline the external image. The rest still works. |
| `Port 3535 is already in use` | The script is already running in another window. |
| `node: command not found` | Install Node.js, then reopen your terminal. |

To test the script without the browser:
```bash
curl -X POST http://127.0.0.1:3535/presence -H "Content-Type: application/json" \
  -d '{"title":"Test Song","artist":"Test Artist","position":10,"duration":200,"paused":false}'
```

## Privacy and security

- The script listens only on `127.0.0.1`, accepts only JSON `POST`s from the extension (it rejects web-page origins, wrong content types and unexpected `Host` headers), and sends no CORS headers, so websites can't read from or talk to it.
- The extension runs only on `music.youtube.com`, requests no browser permissions, and contacts only `127.0.0.1:3535`.
- Nothing is sent anywhere except your own Discord app.

## Project structure

```
ytm-discord-presence/
├── extension/
│   ├── manifest.json     # Extension config (Manifest V3)
│   ├── content.js        # Reads the playing song on music.youtube.com
│   └── background.js     # Relays it to the local script
├── server.js             # Local receiver + Discord IPC client
├── config.example.json   # Template for your Application ID
├── package.json
├── .gitignore
├── LICENSE
└── README.md
```

## License

MIT. See [LICENSE](LICENSE).

This project is not affiliated with or endorsed by Google, YouTube or Discord.

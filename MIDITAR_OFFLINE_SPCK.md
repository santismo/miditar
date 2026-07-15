# Miditar Offline in SPCK Editor on iPhone

`miditar-offline/` is a ready-built static version of Miditar. It includes all app code, icons, and the repository's example MIDI songs. It makes no internet requests during normal use and uses the built-in synth instead of externally hosted instrument samples.

## Put it on the iPhone

Do this once while you have an internet connection:

1. In SPCK Editor, create a project by cloning `https://github.com/santismo/miditar.git`. Downloading the repository ZIP and importing/extracting it in SPCK also works.
2. Open the cloned `miditar` project.
3. Open `miditar-offline/index.html`.
4. Use SPCK's Preview or Run action. If the preview opens inside SPCK, use its external-browser action to open the same local preview URL in Safari.
5. Keep the project on the phone. You can now turn on Airplane Mode and repeat steps 2–4.

SPCK must serve the folder over its local preview server. Opening `index.html` directly as a `file://` URL is not supported. Safari can keep using the page while the local preview server is running; iOS may stop that server if SPCK is force-quit or suspended for a long time.

## Use Miditar Offline

- Choose **Settings → Local Example Song** to open one of the bundled songs.
- Choose **Settings → Open MIDI** to load `.mid` or `.midi` files stored on the iPhone.
- Use **Sound → Offline Synth** for playback.
- Exported guitar MIDI files are created locally by Safari.

## Update it later

When you are online, pull the latest `main` branch in SPCK (or replace the project with a fresh clone). Then preview `miditar-offline/index.html` again.

## Rebuild after source changes

SPCK only needs the already-built folder. On a computer with Node.js, maintainers can regenerate it with:

```bash
npm install
npm run build:offline
```

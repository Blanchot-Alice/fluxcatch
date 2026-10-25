<div align="center">

<img src="docs/assets/icon.png" width="96" alt="Havre" />

# Havre

*Keep what you see.*

A quiet media downloader for Chrome on macOS.<br>
It saves what a page is already playing onto your own Mac, and sends nothing anywhere else.

**English** · [简体中文](README.zh-CN.md)

</div>

<br>

<p align="center">
  <img src="docs/assets/en/downloads.png" width="780" alt="The Havre downloads page">
</p>

Havre (*ahv-ruh*) is the port where Monet grew up and the subject of
*Impression, soleil levant*, the painting that gave Impressionism its name. As
a common noun, *havre* means a harbour: a place where things come in off the
water and are kept safe.

## What it does

- **Sees what the page plays.** Direct files, HLS and DASH, read from the requests the page has already made.
- **Shows the qualities that exist.** Every rendition of a stream sits in one card with a quality menu, and on Bilibili the ladder is the one your own account can play.
- **Saves through a local engine.** A small Python engine downloads, resumes after a pause, uses parallel range transfers where the server allows them, and merges audio and video with FFmpeg.
- **Keeps a record.** Files the engine saves never reach `chrome://downloads`, so Havre keeps its own history, grouped by day, with poster frames, search and Finder actions.
- **Stays on your machine.** No account, no telemetry, no relay. Cookies stay with their own site and are dropped on every cross-origin hop.
- **Leaves DRM alone.** Protected media is detected and reported, never decrypted.

## Sites with their own adapter

Generic detection covers ordinary players. These sites get more care; every
adapter is still in beta.

| Site | What Havre reads |
| --- | --- |
| Bilibili `/video/` | The DASH audio and video pair, and the quality ladder your account can play. |
| Instagram | The best complete MP4 in the page's own data. |
| X | The highest-bitrate progressive MP4. |
| YouTube | Qualities and the file itself, from the yt-dlp installed on your Mac, inside the engine's network policy. |
| Pornhub | The page's quality ladder, as one card. |
| MissAV | The playlist named in the page's packed script, decoded without running it. |
| Jable | The page's AES-128 playlist, decrypted locally by FFmpeg. |
| The Economist Insider | Subscriber episodes your own signed-in session can already play, with their separate audio. |

## Install

1. Clone the repository and load the extension.

   ```bash
   git clone https://github.com/Blanchot-Alice/havre.git
   ```

   Open `chrome://extensions`, turn on **Developer mode**, choose
   **Load unpacked** and select the `extension` folder.

2. Install the local engine. It needs Python 3.9 or newer and uses FFmpeg
   when it finds one.

   ```bash
   ./scripts/native-install-wrapper.sh
   ```

   The [Releases page](https://github.com/Blanchot-Alice/havre/releases) has
   ready-made packages too: unzip the engine bundle whole and run
   `./install-macos.sh`. Updating from FluxCatch 0.2.5 keeps the save folder
   you chose.

3. For YouTube, also install yt-dlp with `brew install yt-dlp`. Havre does not
   bundle it.

Then play something. When the toolbar badge shows a number, click it and
choose what to keep.

Detection works without the engine. Most saving, merging and conversion needs
it; Chrome on its own saves only complete Instagram and X MP4 files.

## The interface

A popup for the page in front of you, a side panel for long downloads, a
downloads page with the whole record, and a Settings page that reads from top
to bottom. Havre follows the system's light or dark appearance, called Morning
and Dusk, and Chrome's language, English or Chinese, unless you pick one in
Settings. It works from the keyboard and respects reduced motion. Its fonts
ship with the extension, so drawing the interface fetches nothing.

<p align="center">
  <img src="docs/assets/en/popup.png" width="300" alt="The popup">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/assets/en/download-dialog.png" width="300" alt="The download dialog">
</p>

The rules behind the look are in [DESIGN.md](DESIGN.md), and
`scripts/design-audit.mjs` checks every screen against them.

## Development

```bash
npm test                     # extension unit and UI tests
npm run test:coverage        # the same, with the coverage gate
python3 -m unittest discover -s native-host/tests
python3 scripts/validate.py  # manifest and syntax checks
npm run test:e2e             # detection, UI and interaction in Chrome for Testing
npm run package              # release archives and SHA256SUMS in dist/
```

Further reading: [Architecture](docs/ARCHITECTURE.md),
[Install](docs/INSTALL.md), [Privacy](PRIVACY.md), [Security](SECURITY.md).

## License

[MIT](LICENSE). Havre is for media you own or may save. It does not decrypt
DRM or bypass access controls.

# Live harness

`tools/live/live.mjs` drives Chrome for Testing with the unpacked extension and
this checkout's native engine against real websites, so a change can be judged
on real detections, real downloads and real files instead of fixtures.

```bash
node tools/live/live.mjs --case direct-mp4,hls,dash,bilibili   # or --case all
node tools/live/live.mjs --case hls --headed --keep             # watch it, keep the profile
node tools/live/live.mjs --case hls --finder                    # also open the folder in Finder at the end
```

Per case it opens the page in a disposable profile, starts playback, waits for
FluxCatch to detect the expected kind, screenshots the popup, probes the quality
ladder and starts a download at the lowest quality, polls the job to its end,
then checks the durable history record (media facts, poster frame), the file on
disk (`ffprobe`), the engine's existence check, and screenshots the popup's job
list, the Side Panel, the settings page and the downloads page.

Everything it writes stays under `tools/live/out/<run>/` (gitignored): the
extension copy, `host-launcher.sh`, downloaded files, screenshots, `live.log`
and `report.json`. The extension copy grants `nativeMessaging` and
`notifications` up front because Chrome cannot show optional-permission prompts
unattended; the extension key, and so the ID the engine trusts, is unchanged.

The native-messaging registration is written **inside the disposable profile**
(`<profile>/NativeMessagingHosts/`), which is where Chrome looks when it runs
with a custom `--user-data-dir`. The user's Chrome, profile and installed
engine are never touched. The launcher runs `native-host/host.py` from this
checkout with `FLUXCATCH_DOWNLOAD_DIR` pointing at the run's `files/` folder.

Exit code is non-zero when any case fails. Needs Node 22+ (global `WebSocket`),
a Playwright Chrome for Testing under `~/Library/Caches/ms-playwright` (or
`CHROME_PATH`), Python 3.9+ and FFmpeg/ffprobe from Homebrew.

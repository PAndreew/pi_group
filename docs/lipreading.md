# Experimental silent dictation

## User flow

No modal or camera preview. An empty composer shows blue audio lines in the Send position. Click to allow the front camera and record immediately; the button becomes a red Stop square with an inline timer. Stop manually (10-second limit) to transcribe into the ordinary chat input. Edit the draft and press Send normally. Typing cancels recording/upload and prevents a late transcript from replacing typed text. No microphone is used.

**All ML runs in a persistent native service on the Pi**, not in the browser. Refreshing the phone does not reload the model. The camera clip is uploaded to the Pi after Stop. The service processes it in RAM and does not save or log recordings/transcripts. This is a change from the initial browser-local prototype: video now leaves the recording device for your Beezy server. Use HTTPS outside localhost.

Silent free-form lip-reading is experimental. Visually ambiguous words cannot be recovered reliably by an LLM. Names/code are particularly difficult. Published accuracy on voiced footage does not establish accuracy for silent mouthing.

## Install the native service

Linux ARM64/x86-64, Python 3.11, Node.js and ffmpeg are needed. On this machine:

```sh
bash lipread/install.sh
npm run deploy
```

The installer:

- Downloads/checks the pinned ONNX model and vocabulary into `~/.local/share/beezy-lipread/models` (not Git or frontend assets).
- Installs the native Python runtime in `~/.local/share/beezy-lipread/.venv`, copies `worker.py`, and enables the user `beezy-lipread.service`.
- Generates a private bearer token in `~/.config/beezy-lipread/runtime.env` and adds matching `LIPREAD_SERVICE_URL`/`LIPREAD_SERVICE_TOKEN` to the checkout's ignored `.env`. Neither file belongs in Git.
- Starts an authenticated, **loopback-only** service on port 8792. Beezy's authenticated API proxies requests to it; browsers never receive its bearer token.

The model/detector load and warm once at service startup, then stay resident independently of Beezy/browser restarts. The service only reports healthy once warm. To update the worker, rerun the installer and `systemctl --user restart beezy-lipread`; installing over an already-running service does not hot-replace its Python process. No browser model installation or preload is required.

```sh
systemctl --user status beezy-lipread
journalctl --user -u beezy-lipread
```

To uninstall/disable recognition without removing chat data: `systemctl --user disable --now beezy-lipread`. Ordinary typing still works. The composer reports a missing/offline service inline; no browser fallback downloads a model.

## Processing and bounds

- Browser MediaRecorder records WebM/VP8 where available, or MP4 on Safari, without displaying video.
- Authenticated `POST /api/lipread/transcribe`: video body, max 12 MB, CSRF/tenant headers, no storage.
- Native worker: one inference at a time; concurrent clips receive 429 rather than queueing indefinitely. Gateway timeout 90 seconds. Decoder timeout 25 seconds.
- ffmpeg decodes at 25fps to 480×360, capped at 250 frames. Input uses a private, seekable `/dev/shm` temporary file so Safari MP4 also works; it is unlinked after decoding. Network demuxer protocols are disabled and formats restricted to MP4/WebM.
- MediaPipe short-range face detection → missing-point interpolation → ±6-frame smoothing with centre correction → similarity alignment to Auto-AVSR's mean face → 88×88 grayscale mouth crops → `(pixel/255 - 0.421)/0.165` → native ONNX Runtime CPU → greedy CTC.
- No recordings, transcripts, auth headers or request bodies are logged. Raw decoded frames, crops and input bytes are released after each request. ffmpeg may inspect codec metadata but its stderr is not exposed or logged.
- Cancelling a browser request prevents draft insertion. A native inference already underway may finish its bounded computation; it never inserts text on its own.

## Model and benchmark

[eschmechel/auto-avsr-lrs3-vsr-int8-onnx](https://huggingface.co/eschmechel/auto-avsr-lrs3-vsr-int8-onnx), revision `9359b251b8d9b8e2d63bada99013bb92eee3b087`. 203.4 MB decimal, English encoder/CTC checkpoint. SHA-256 checked by `web/scripts/setup-lipread.mjs` (retained at its original path, now installs native assets only).

Research/non-commercial model terms, according to the model card; not included in Beezy's source license. The author reports ~28.5% WER on 100 LRS3 clips with greedy decoding, not silent-mouthing performance. This has not been independently reproduced here. Deterministic least-squares alignment differs from upstream OpenCV LMEDS; validate real quality before assuming reference accuracy.

Pi 5 8GB, ONNX Runtime 1.24.3, three inference threads:

| Synthetic clip | Native inference |
|---|---:|
| 1 second | 0.96 s |
| 5 seconds | 4.06 s |
| 10 seconds | 6.47 s |

Load plus warmup: 3.9s, **once per native service start**. Warm service RSS after startup: about 526 MiB; longer inference can increase the runtime arena. A static public portrait encoded as a 1s MP4 exercised decoding, face tracking, cropping and inference in 0.8s twice with the same service PID. Its transcript was empty. These are execution/latency checks, **not silent speech accuracy tests**.

## Optional text correction

Configure and restart Beezy:

```dotenv
LIPREAD_LLM_API_KEY=your-provider-key
LIPREAD_LLM_MODEL=your-cheap-fast-model
# Optional OpenAI-compatible endpoint:
LIPREAD_LLM_URL=https://api.openai.com/v1/chat/completions
```

This opts into automatic correction after recognition, before the draft appears. The recording hint indicates when LLM correction is enabled. Only transcript text goes to that provider; keys remain server-side. Correction failure preserves the raw draft and adds a hint. The prompt requests conservative edits, but cannot guarantee correctness. Always review before Send. No provider/model is chosen or charged by default. One correction per signed-in user at a time, 20-second timeout, 4000-character input and 512-token output limits apply; shared installations should add a spending quota.

## Tests

```sh
npm --prefix server run build
npm --prefix server run test:deploy
npm --prefix web test
# Against Vite, or TEST_URL pointing at a production build (fake camera and mocked API):
(cd web && node test/lipread-ui.mjs)
(cd web && node test/lipread-live-smoke.mjs)
~/.local/share/beezy-lipread/.venv/bin/python -m unittest discover -s lipread -v
# Native model benchmark; uses synthetic crops, not an accuracy evaluation:
OPENBLAS_NUM_THREADS=1 ~/.local/share/beezy-lipread/.venv/bin/python lipread/worker.py --benchmark
```

## Omni retirement (2026-11-03)

Before removal, Gitleaks 8.30.1 scanned full Git history and staged source with zero findings. A filesystem scan found credentials only in ignored `server/.env` and `server/gcp-tts-key.json`; neither was tracked. Source was committed and pushed to `PAndreew/omni` at `fafe55caa5fd537bf1b5f0a09ed1f46cdef731c4`, and the remote hash was verified. Omni's services, container, image and source checkout were removed. Private credentials/data and user service configuration remain in `~/Backups/omni-retired/private-runtime.tgz` (directory 0700, archive 0600). Never upload this secret archive to GitHub.

# Experimental silent dictation

No modal or camera preview. Beezy preloads the recognition model and face detector when the signed-in chat composer mounts, **before recording** and without requesting camera permission. While warming up, the empty-input Send position shows a disabled blue spinner and a small preparation hint. Once ready it becomes blue audio lines. Click to allow the front camera and record; the same button becomes a red Stop square with an inline timer. Click Stop (or reach the 10-second limit) to transcribe into the ordinary chat input. Edit the draft and press Send normally—nothing auto-sends. Typing at any stage cancels capture/processing and restores Send; late results cannot overwrite the typed draft. Models stay warm until page unload. First-use downloading cannot be eliminated, but it happens before the recording button is enabled.

Requires HTTPS or localhost, a camera, WebAssembly SIMD, and sufficient browser memory. This is an experiment, not reliable dictation. Visually ambiguous words cannot be recovered reliably by an LLM. Names/code are especially difficult. Silent mouthing differs from the voiced footage used in the published evaluations.

## Installation

From the repository root:

```sh
npm --prefix web ci
node web/scripts/setup-lipread.mjs
npm --prefix web run build
npm --prefix server run build
```

Assets are optional, ignored by Git, and occupy approximately 230 MB (plus another copy in web/dist after building). The setup script pins the HF revision and checks SHA-256 for the ONNX model and vocabulary. It downloads Google's versioned BlazeFace short-range model and copies installed MediaPipe/ONNX WASM runtimes. Run the script before building on each installation. No PyTorch, Python environment, or GPU is needed.

**Local deployment:** Beezy's release builder copies installed `web/public/lipread` assets into the candidate release when `ready.json` is present. Weights remain outside Git. On another machine, run the asset setup script before deploying.

## Model and preprocessing

- [eschmechel/auto-avsr-lrs3-vsr-int8-onnx](https://huggingface.co/eschmechel/auto-avsr-lrs3-vsr-int8-onnx), revision `9359b251b8d9b8e2d63bada99013bb92eee3b087`.
- 203.4 MB decimal, INT8 encoder/CTC model; English vocabulary. Not the 95M AV-HuBERT backbone.
- Research/non-commercial model terms, according to its model card. Not included in Beezy's source license. Review upstream terms before broader use.
- Author reports ~28.5% WER on 100 LRS3 clips with greedy decoding, NOT silent-mouthing performance. Not independently reproduced here.
- Pipeline: hidden camera without microphone → raw frame capture (no ML startup dependency) → after Stop, BlazeFace eye/nose/mouth points → 25fps nearest-frame resampling → missing-point interpolation → ±6-frame smoothing with centre correction → least-squares similarity alignment to Auto-AVSR's mean face → 96px mouth region, centre-cropped to 88px grayscale → `(pixel/255 - 0.421)/0.165` → ONNX WASM worker → greedy CTC.
- Alignment uses deterministic least-squares fitting rather than upstream OpenCV LMEDS; canvas interpolation/grayscale ordering also differs slightly. Validate real accuracy before treating this as equivalent to the reference implementation.
- Full camera frames exist only in browser memory while recording/preprocessing. Crops and full frames are not uploaded or persisted. Stopping, typing or leaving the composer stops camera tracks and clears captured frames. Only the recognition model and static detector remain warm for this page session. No external CDN is used during capture.

## Run on the phone/laptop instead of the Pi

Simply open Beezy there. Camera capture, preprocessing and WASM inference run on **the device opening the page**, not the server. The Pi serves model files. The first load transfers ~203 MB of weights over your connection. Browser HTTP caching may save later transfers; decoded tensors still require much more memory than the file size. WASM is single-threaded to avoid requiring cross-origin isolation. WebGPU is not enabled; support for this model's quantized operations must be tested separately.

## Optional text correction

Configure server environment variables, then restart:

```dotenv
LIPREAD_LLM_API_KEY=your-provider-key
LIPREAD_LLM_MODEL=your-cheap-fast-model
# Optional OpenAI-compatible chat-completions endpoint:
LIPREAD_LLM_URL=https://api.openai.com/v1/chat/completions
```

Configuring these variables opts into automatic text correction after recognition, before the draft appears in the ordinary input. The recording hint states when LLM text correction is enabled. Only transcript text goes to the provider; the key stays server-side. Without configuration, recognition remains entirely local. Correction failure preserves the raw draft and adds an inline hint. The system prompt asks for conservative punctuation/casing/grammar repair and no invented missing content. It cannot guarantee correctness; always review the draft. No model/provider is chosen or charged by default. One concurrent request per signed-in user, a 20-second timeout, 4000-character input limit and 512 output-token limit apply. Shared deployments should add a spend quota before enabling it broadly.

## Tests and benchmark

```sh
npm --prefix web test
# With the Vite development server running on localhost:5173:
cd web && node test/lipread-benchmark.mjs
# Mocked browser UI/state regression test against Vite (not a recognition accuracy test):
node test/lipread-ui.mjs
```

Pi 5 8GB, headless Chromium, single-thread WASM: a 25-frame **synthetic constant-image** clip loaded in 3.8s and inferred in 2.8s. This proves model execution, not face preprocessing or recognition quality. Real clip latency may differ; longer clips have different scaling. The synthetic output was empty, as expected. No silent human recording has been evaluated yet.

## Omni retirement (2026-11-03)

Before removal, Gitleaks 8.30.1 scanned full Git history and staged source with zero findings. A filesystem scan found credentials only in ignored `server/.env` and `server/gcp-tts-key.json`; neither was tracked. Source was committed and pushed to `PAndreew/omni` at `fafe55caa5fd537bf1b5f0a09ed1f46cdef731c4`, and the remote hash was verified. The Omni services were disabled/stopped and its container, image and source checkout removed. Private credentials, data and user service configuration are preserved in `~/Backups/omni-retired/private-runtime.tgz` (directory 0700, archive 0600). This archive contains secrets: never upload it to GitHub. Other app caches/data were not indiscriminately purged.

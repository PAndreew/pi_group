#!/usr/bin/env python3
"""Persistent, loopback-only native visual speech recognition. Clips stay in RAM."""
import argparse
import hmac
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort

MAX_BYTES = 12 * 1024 * 1024
REFERENCE = np.array([[102.073943, 94.272304], [156.361305, 93.578156],
                      [129.003738, 135.903430], [129.313373, 157.822996]], dtype=np.float32)


def fill_landmarks(landmarks):
    valid = [i for i, value in enumerate(landmarks) if value is not None]
    if not valid:
        raise ValueError("No face detected. Face the front camera in good light and try again.")
    result = list(landmarks)
    for i in range(len(result)):
        if result[i] is not None:
            continue
        left = max((v for v in valid if v < i), default=valid[0])
        right = min((v for v in valid if v > i), default=valid[-1])
        ratio = 0 if left == right else (i - left) / (right - left)
        result[i] = landmarks[left] + ratio * (landmarks[right] - landmarks[left])
    return result


def similarity(source, target=REFERENCE):
    s, t = source.mean(axis=0), target.mean(axis=0)
    centred, target_centred = source - s, target - t
    norm = np.square(centred).sum()
    if norm < 1e-6:
        raise ValueError("Invalid face landmarks")
    a = (centred * target_centred).sum() / norm
    b = (centred[:, 0] * target_centred[:, 1] - centred[:, 1] * target_centred[:, 0]).sum() / norm
    matrix = np.array([[a, -b], [b, a]], dtype=np.float32)
    return np.column_stack([matrix, t - matrix @ s]).astype(np.float32)


def decode_ctc(logits, tokens):
    pieces, previous = [], -1
    for index in logits.argmax(axis=-1).reshape(-1):
        index = int(index)
        if index != previous and index not in (0, len(tokens) - 1):
            pieces.append(tokens[index])
        previous = index
    return "".join(pieces).replace("▁", " ").strip()


def decode_video(data):
    # Fixed output geometry/frame cap bounds decoded memory, regardless of input resolution/duration.
    command = ["ffmpeg", "-v", "error", "-nostdin", "-threads", "2", "-filter_threads", "1",
               "-max_alloc", "100000000", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-i", "INPUT",
               "-an", "-vf", "fps=25,scale=480:360:force_original_aspect_ratio=increase,crop=480:360",
               "-frames:v", "250", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    try:
        # RAM-backed seekable input also handles Safari MP4 with metadata at the end.
        with tempfile.NamedTemporaryFile(dir="/dev/shm", prefix="beezy-lipread-") as clip:
            clip.write(data); clip.flush()
            command[command.index("INPUT")] = clip.name
            result = subprocess.run(command, capture_output=True, timeout=25, check=False)
    except subprocess.TimeoutExpired as error:
        raise ValueError("Video decoding timed out") from error
    if result.returncode or len(result.stdout) < 10 * 480 * 360 * 3:
        raise ValueError("Could not decode the recording. Record at least half a second and try again.")
    size = 480 * 360 * 3
    if len(result.stdout) % size or len(result.stdout) > 250 * size:
        raise ValueError("Invalid decoded video")
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, 360, 480, 3)


class Recognizer:
    def __init__(self, directory, threads=3):
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(directory / "lipread_ctc.int8.onnx"), sess_options=options,
                                           providers=["CPUExecutionProvider"])
        self.tokens = json.loads((directory / "tokens.json").read_text())
        cv2.setNumThreads(1)
        # The short-range model and graph are bundled with MediaPipe; no runtime download.
        self.detector = mp.solutions.face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5)
        self.session.run(["log_probs"], {"video": np.zeros((1, 1, 25, 88, 88), dtype=np.float32)})

    def infer_crops(self, crops):
        x = (crops.astype(np.float32) / 255.0 - 0.421) / 0.165
        output = self.session.run(["log_probs"], {"video": x[None, None]})[0]
        return decode_ctc(output, self.tokens)

    def transcribe(self, data):
        began = time.monotonic()
        video = decode_video(data)
        landmarks, grayscale = [], []
        for frame in video:
            results = self.detector.process(frame)
            faces = results.detections or []
            if faces:
                face = max(faces, key=lambda f: f.location_data.relative_bounding_box.width * f.location_data.relative_bounding_box.height)
                points = face.location_data.relative_keypoints[:4]
                landmarks.append(np.array([[p.x * 480, p.y * 360] for p in points], dtype=np.float32))
            else:
                landmarks.append(None)
            grayscale.append(cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY))
        count = len(video)
        del video
        points = fill_landmarks(landmarks)
        crops = np.empty((count, 88, 88), dtype=np.uint8)
        for i, frame in enumerate(grayscale):
            margin = min(6, i, count - 1 - i)
            smooth = np.mean(points[i - margin:i + margin + 1], axis=0)
            smooth += points[i].mean(axis=0) - smooth.mean(axis=0)
            matrix = similarity(smooth)
            centre = matrix[:, :2] @ smooth[3] + matrix[:, 2]
            # Equivalent to a 96px mouth patch followed by an 88px centre crop.
            matrix[:, 2] -= np.round(centre - 48) + 4
            crops[i] = cv2.warpAffine(frame, matrix, (88, 88), flags=cv2.INTER_LINEAR)
        del grayscale
        prepared = time.monotonic()
        text = self.infer_crops(crops)
        return {"text": text, "seconds": round(time.monotonic() - began, 3),
                "inferenceSeconds": round(time.monotonic() - prepared, 3), "duration": count / 25}


def create_server(recognizer, token, port):
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass  # Never log clips, transcripts, auth headers, or request bodies.

        def reply(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            self.close_connection = True

        def authorized(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.reply(401, {"error": "Unauthorized"})
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            if self.path != "/health":
                return self.reply(404, {"error": "Not found"})
            self.reply(200, {"ready": True, "busy": lock.locked(), "pid": os.getpid()})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != "/transcribe":
                return self.reply(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if not 0 < length <= MAX_BYTES:
                return self.reply(413, {"error": "Recording must be at most 12 MB"})
            if not lock.acquire(blocking=False):
                return self.reply(429, {"error": "Lip reader is busy. Please try again in a moment."})
            try:
                self.connection.settimeout(20)
                data = self.rfile.read(length)
                if len(data) != length:
                    raise ValueError("Incomplete recording")
                self.reply(200, recognizer.transcribe(data))
            except (ValueError, TimeoutError) as error:
                self.reply(422, {"error": str(error)})
            except Exception:
                self.reply(500, {"error": "Lip recognition failed; try a shorter recording"})
            finally:
                lock.release()

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, default=Path(os.environ.get("LIPREAD_MODEL_DIR", Path.home() / ".local/share/beezy-lipread/models")))
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()
    began = time.monotonic()
    recognizer = Recognizer(args.model_dir, int(os.environ.get("LIPREAD_THREADS", "3")))
    if args.benchmark:
        times = {}
        for frames in (25, 125, 250):
            start = time.monotonic()
            recognizer.infer_crops(np.full((frames, 88, 88), 107, dtype=np.uint8))
            times[str(frames / 25)] = round(time.monotonic() - start, 3)
        print(json.dumps({"loadAndWarmupSeconds": round(time.monotonic() - began - sum(times.values()), 3), "inferenceSecondsByClipSeconds": times}))
        return
    token = os.environ.get("LIPREAD_SERVICE_TOKEN")
    if not token:
        raise SystemExit("LIPREAD_SERVICE_TOKEN is required")
    port = int(os.environ.get("LIPREAD_PORT", "8792"))
    server = create_server(recognizer, token, port)
    print(json.dumps({"ready": True, "pid": os.getpid(), "port": port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

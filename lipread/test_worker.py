import json
import http.client
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import numpy as np
from worker import create_server, decode_ctc, decode_video, fill_landmarks, similarity


class MathTest(unittest.TestCase):
    def test_ctc(self):
        tokens = ['<blank>', '▁HI', '▁YOU', '<eos>']
        ids = [0, 1, 1, 0, 1, 2, 2, 3]
        logits = np.full((len(ids), len(tokens)), -10)
        logits[np.arange(len(ids)), ids] = 0
        self.assertEqual(decode_ctc(logits, tokens), 'HI HI YOU')

    def test_interpolation(self):
        actual = fill_landmarks([None, np.array([[0, 0]]), None, np.array([[4, 2]]), None])
        np.testing.assert_equal(actual, [[[0, 0]], [[0, 0]], [[2, 1]], [[4, 2]], [[4, 2]]])
        with self.assertRaisesRegex(ValueError, 'No face'):
            fill_landmarks([None])

    def test_similarity(self):
        source = np.array([[0, 0], [1, 0], [0, 1], [1, 1]], dtype=np.float32)
        target = source @ np.array([[2, 1], [-1, 2]]) + [7, -3]
        np.testing.assert_allclose(similarity(source, target), [[2, -1, 7], [1, 2, -3]], atol=1e-6)

    def test_decoder_rejects_invalid_input(self):
        with self.assertRaisesRegex(ValueError, 'Could not decode'):
            decode_video(b'not a recording')

    def test_chrome_webm_and_seekable_safari_mp4(self):
        # MP4 here deliberately puts metadata at the end, requiring seekable RAM input.
        for extension, codec in [('webm', 'libvpx'), ('mp4', 'libx264')]:
            with self.subTest(format=extension), tempfile.NamedTemporaryFile(dir='/dev/shm', suffix='.' + extension) as clip:
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-f', 'lavfi', '-i',
                                'color=c=black:s=480x360:r=25:d=1', '-c:v', codec, '-threads', '1', '-pix_fmt', 'yuv420p', clip.name], check=True, timeout=15)
                frames = decode_video(Path(clip.name).read_bytes())
                self.assertEqual(frames.shape, (25, 360, 480, 3))


class ServiceTest(unittest.TestCase):
    def test_auth_limits_busy_and_persistent_recognizer(self):
        class FakeRecognizer:
            calls = 0
            block = False
            entered = threading.Event()
            release = threading.Event()

            def transcribe(self, data):
                self.calls += 1
                if self.block:
                    self.entered.set(); self.release.wait(5)
                return {'text': 'HELLO', 'seconds': 0.1, 'inferenceSeconds': 0.05, 'duration': 1}

        recognizer = FakeRecognizer()
        server = create_server(recognizer, 'test-only', 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = 'http://127.0.0.1:' + str(server.server_address[1])

        def call(path, data=None, authorized=True):
            headers = {'Authorization': 'Bearer test-only'} if authorized else {}
            return urlopen(Request(base + path, data=data, headers=headers), timeout=10)

        try:
            with self.assertRaises(HTTPError) as error:
                call('/health', authorized=False)
            self.assertEqual(error.exception.code, 401)
            before = json.load(call('/health'))
            for _ in range(2):
                self.assertEqual(json.load(call('/transcribe', b'fake clip'))['text'], 'HELLO')
            self.assertEqual(recognizer.calls, 2)
            self.assertEqual(json.load(call('/health'))['pid'], before['pid'])
            oversized = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=5)
            oversized.putrequest('POST', '/transcribe')
            oversized.putheader('Authorization', 'Bearer test-only')
            oversized.putheader('Content-Length', str(12 * 1024 * 1024 + 1)); oversized.endheaders()
            self.assertEqual(oversized.getresponse().status, 413); oversized.close()
            recognizer.block = True
            pending = threading.Thread(target=lambda: call('/transcribe', b'fake clip').close())
            pending.start(); self.assertTrue(recognizer.entered.wait(5))
            with self.assertRaises(HTTPError) as error:
                call('/transcribe', b'another clip')
            self.assertEqual(error.exception.code, 429)
            self.assertTrue(json.load(call('/health'))['busy'])
            recognizer.release.set(); pending.join(5)
        finally:
            recognizer.release.set(); server.shutdown(); server.server_close(); thread.join(5)


if __name__ == '__main__':
    unittest.main()

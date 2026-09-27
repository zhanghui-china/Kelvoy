"""Render original instrumental demo loops with only Python's standard library.

Run from the repository root: python3 scripts/generate-demo-music.py
The WAV master is temporary; ffmpeg encodes the checked-in MP3 files.
"""

import math
import random
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

RATE = 22050
SECONDS = 32
OUT = Path(__file__).resolve().parents[1] / "assets/shared/music"

TRACKS = [
    ("calm_morning", 84, 60, [(0, 4, 7), (5, 9, 12), (9, 12, 16), (7, 11, 14)]),
    ("city_walk", 100, 62, [(0, 4, 7), (7, 11, 14), (9, 12, 16), (5, 9, 12)]),
    ("bright_travel", 120, 65, [(0, 4, 7), (5, 9, 12), (7, 11, 14), (0, 4, 7)]),
    ("night_neon", 128, 57, [(0, 3, 7), (8, 12, 15), (5, 8, 12), (7, 10, 14)]),
    ("wide_nature", 92, 55, [(0, 4, 7), (5, 9, 12), (2, 5, 9), (7, 11, 14)]),
]


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def render(name, bpm, root, progression):
    rng = random.Random(name)
    beat_length = 60 / bpm
    bar_length = beat_length * 4
    output = OUT / f"{name}.mp3"
    with tempfile.TemporaryDirectory() as temporary:
        wav_path = Path(temporary) / "master.wav"
        with wave.open(str(wav_path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            frames = bytearray()
            for index in range(RATE * SECONDS):
                t = index / RATE
                bar = int(t / bar_length) % len(progression)
                chord = progression[bar]
                beat_phase = (t % beat_length) / beat_length
                eighth = int(t / (beat_length / 2))
                pluck_age = t % (beat_length / 2)
                note = root + chord[eighth % 3] + 12
                pad = sum(math.sin(2 * math.pi * hz(root + interval) * t) for interval in chord) / 3
                pad += 0.25 * sum(math.sin(2 * math.pi * hz(root + interval) * 0.501 * t) for interval in chord) / 3
                pluck = math.sin(2 * math.pi * hz(note) * t) * math.exp(-8 * pluck_age)
                bass = math.sin(2 * math.pi * hz(root + chord[0] - 12) * t) * math.exp(-5 * beat_phase)
                shaker = (rng.random() * 2 - 1) * math.exp(-42 * pluck_age) * 0.08
                fade = min(1, t / 0.8, (SECONDS - t) / 1.8)
                sample = max(-1, min(1, (0.18 * pad + 0.25 * pluck + 0.22 * bass + shaker) * fade))
                frames.extend(struct.pack("<h", round(sample * 32767)))
                if len(frames) >= 32768:
                    wav.writeframes(frames)
                    frames.clear()
            if frames:
                wav.writeframes(frames)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path),
                        "-c:a", "libmp3lame", "-b:a", "96k", str(output)], check=True)
    print(output)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for track in TRACKS:
        render(*track)

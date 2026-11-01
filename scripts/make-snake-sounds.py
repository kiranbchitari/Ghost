# Synthesizes Snake's chiptune sound effects into the given folder (standard library only).
# Usage: python3 scripts/make-snake-sounds.py assets/sounds
import math
import os
import struct
import sys
import wave

out = sys.argv[1]
RATE = 22050


def tone(freq, ms, wave_kind='square', volume=0.5, slide_to=None, duty=0.5):
    """One note; slide_to bends the pitch linearly to that frequency."""
    n = int(RATE * ms / 1000)
    samples = []
    phase = 0.0
    seed = 1
    for i in range(n):
        t = i / n
        f = freq + ((slide_to or freq) - freq) * t
        phase = (phase + f / RATE) % 1.0
        if wave_kind == 'square':
            v = 1.0 if phase < duty else -1.0
        elif wave_kind == 'triangle':
            v = 4 * abs(phase - 0.5) - 1
        else:  # noise
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            v = (seed / 0x7FFFFFFF) * 2 - 1
        # Short attack and release so notes don't click.
        edge = min(1.0, i / (RATE * 0.003), (n - i) / (RATE * 0.008))
        samples.append(v * volume * edge)
    return samples


def rest(ms):
    return [0.0] * int(RATE * ms / 1000)


def save(name, samples):
    with wave.open(os.path.join(out, name + '.wav'), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in samples))


os.makedirs(out, exist_ok=True)

# Apple: a quick upward blip.
save('eat', tone(660, 45, volume=0.35, slide_to=990, duty=0.25))
# Cherry: two rising notes.
save('bonus', tone(784, 50, volume=0.35, duty=0.25) + tone(1175, 70, volume=0.35, duty=0.25))
# Golden apple: a bright arpeggio.
save('golden', sum((tone(f, 45, volume=0.3, duty=0.25) for f in (784, 988, 1175, 1568)), []))
# Poison: a sour downward wobble.
save('poison', tone(330, 90, volume=0.4, slide_to=220) + tone(233, 120, volume=0.4, slide_to=150))
# Power-up: a sweep up.
save('power', tone(392, 160, wave_kind='triangle', volume=0.6, slide_to=1568))
# Shield takes a hit: a short thud.
save('shield', tone(180, 40, wave_kind='noise', volume=0.35) + tone(220, 60, wave_kind='triangle', volume=0.6, slide_to=160))
# Crash / game over: a burst of noise and a falling tone.
save('crash', tone(0, 90, wave_kind='noise', volume=0.4) + tone(440, 380, volume=0.35, slide_to=110))
# Level cleared / challenge done: a short fanfare.
save('win', sum((tone(f, 90, volume=0.3, duty=0.25) + rest(15) for f in (523, 659, 784)), []) + tone(1047, 260, volume=0.3, duty=0.25))

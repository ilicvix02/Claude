"""Original background music for the videos: a news-theme bed synthesized from scratch (no samples, no
licensed tracks), cut to the edit.

    pip install -r requirements-video.txt
    python3 scripts/music.py --out bed.wav --total 42.5 --bpm 132 --cuts 2.4,4.8,7.9 \\
        [--sections drop:3.6,break:19.2,lift:24.0,final:30.5] [--style promo|brief] [--seed 7] [--end-sting]

Writes a 48 kHz stereo 16-bit WAV exactly --total seconds long. The groove is 4/4 at --bpm, stretched by
a few percent at most so that sections and nearby cuts land on a beat. Every cut gets a hit with a reverse
swell into it, plus a drum fill when it lands on a bar line. --sections is the energy curve (build, drop,
break, lift, final); without it one is derived from --total and the cuts. promo is the high-energy ad bed
that hits on the first frame; brief is calmer and lighter, to sit under a narrated brief. --end-sting ends
on a hit, a short cadence and a reverb tail that dies exactly at --total. Same arguments, same file.

Everything is numpy: band-limited wavetables with resonant filter sweeps, synthetic drums, FFT convolution
reverb, sidechain pumping, bus compression and a true-peak-safe limiter. Integrated loudness lands near
-16 LUFS (promo) or -20 LUFS (brief), with a gentle dip around 2 kHz to leave room for a voice.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SR = 48000
NAMES = ("build", "drop", "break", "lift", "final")


# ---------------------------------------------------------------------------------------------- DSP

def rng_for(seed: int, *names) -> np.random.Generator:
    """An independent random stream per named part, so changing one part never reshuffles another."""
    return np.random.default_rng([seed & 0xFFFFFFFF, zlib.crc32("/".join(map(str, names)).encode())])


def hz(midi):
    return 440.0 * 2.0 ** ((np.asarray(midi, dtype=np.float64) - 69.0) / 12.0)


def fast_len(n: int) -> int:
    """Smallest 2^a 3^b 5^c >= n: the sizes numpy's FFT is quickest at."""
    best = 1 << max(0, (n - 1).bit_length())
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            p = p35
            while p < n:
                p *= 2
            best = min(best, p)
            p35 *= 3
        p5 *= 5
    return best


# Analog filter prototypes, evaluated per frequency (Hz) and applied in the FFT domain by filt().
def lowpass(fc, q=0.7071):
    return lambda f: 1.0 / (1.0 - (f / fc) ** 2 + 1j * (f / fc) / q)


def highpass(fc, q=0.7071):
    def h(f):
        w = f / fc
        return -(w * w) / (1.0 - w * w + 1j * w / q)
    return h


def bandpass(fc, q=1.0):
    def h(f):
        w = f / fc
        return (1j * w / q) / (1.0 - w * w + 1j * w / q)
    return h


def bell(fc, db, q=1.0):
    a = 10.0 ** (db / 40.0)
    def h(f):
        s = 1j * f / fc
        return (s * s + s * (a / q) + 1.0) / (s * s + s / (a * q) + 1.0)
    return h


def high_shelf(fc, db):
    a = math.sqrt(10.0 ** (db / 20.0))
    def h(f):
        s = 1j * f / fc
        return (a * s + 1.0) / (s / a + 1.0)
    return h


def response(m, *responses):
    """The product of the responses at the bins of an m-point real FFT. A long FFT's bins are far finer than
    any of these filters, so there they are worked out on a ~1 Hz grid and interpolated."""
    bins = m // 2 + 1
    step = max(1, m // SR)
    k = np.arange(0, bins + step, step)
    h = np.ones(len(k), dtype=np.complex128)
    for r in responses:
        h *= r(k * (SR / m))
    if step == 1:
        return h[:bins]
    fine = np.arange(bins)
    return np.interp(fine, k, h.real) + 1j * np.interp(fine, k, h.imag)


def filt(x, *responses, pad=4096):
    """Run x (last axis = time) through the product of the given responses."""
    x = np.asarray(x, dtype=np.float64)
    n = x.shape[-1]
    m = fast_len(n + pad)
    return np.fft.irfft(np.fft.rfft(x, m) * response(m, *responses), m)[..., :n]


def convolve(x, ir):
    """x: (2, n), ir: (2, m) -> (2, n + m - 1)."""
    n, m = x.shape[-1], ir.shape[-1]
    size = fast_len(n + m)
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[..., :n + m - 1]


def fade(x, a=0.0005, r=0.004):
    """Raised-cosine ramps over the first a and last r seconds (in place), so nothing starts or stops on a click."""
    n = x.shape[-1]
    ia, ir = min(n, max(2, int(a * SR))), min(n, max(2, int(r * SR)))
    x[..., :ia] *= np.sin(np.linspace(0.0, np.pi / 2, ia)) ** 2
    x[..., n - ir:] *= np.cos(np.linspace(0.0, np.pi / 2, ir)) ** 2
    return x


def pan(x, p=0.0):
    """Mono -> stereo, constant power, unity in both channels at centre."""
    a = (p + 1.0) * math.pi / 4
    return np.stack([x * (math.cos(a) * math.sqrt(2)), x * (math.sin(a) * math.sqrt(2))])


def adsr(n, a, d, s, r, gate):
    """Attack a, exponential decay (time constant d) to sustain s, release to -60 dB over r after gate."""
    t = np.arange(n, dtype=np.float32) / np.float32(SR)
    env = np.sin(np.minimum(1.0, t / max(a, 1e-4)) * np.float32(np.pi / 2)) ** 2
    env *= s + (1.0 - s) * np.exp(-np.maximum(t - a, 0.0) / np.float32(max(d, 1e-4)))
    if gate < n / SR:
        k = int(gate * SR)
        env[k:] *= np.exp(-t[:n - k] * np.float32(6.9 / max(r, 1e-3)))
    return fade(env, a=0.0, r=0.003)


def smooth(x, seconds, rate=SR):
    """Two passes of a centred box filter (a triangle): click-free ramps out of hard steps."""
    w = max(1, int(seconds * rate))
    for _ in range(2):
        c = np.cumsum(np.pad(x, (w // 2 + 1, w - w // 2), mode="edge"))
        x = (c[w:w + len(x)] - c[:len(x)]) / w
    return x


def shaped_noise(n, shape, rng, hop=256, size=1024):
    """Noise whose short-time spectrum follows shape(times, freqs) -> magnitudes (frames x bins), by STFT
    synthesis: random-phase spectra, windowed and overlap-added. A flat shape of 1 gives unit variance."""
    frames = n // hop + size // hop + 1
    t = np.arange(frames) * hop / SR
    f = np.fft.rfftfreq(size, 1.0 / SR)
    mag = shape(t, f)
    spec = mag * (rng.standard_normal(mag.shape) + 1j * rng.standard_normal(mag.shape))
    grains = np.fft.irfft(spec, size, axis=1) * np.hanning(size) * math.sqrt(size / 3.0)
    r = size // hop
    grains = grains.reshape(frames, r, hop)
    out = np.zeros((frames + r - 1, hop))
    for k in range(r):
        out[k:k + frames] += grains[:, k, :]
    return out.ravel()[size // 2: size // 2 + n]


def make_ir(rt60, length, predelay, rng, damp=0.5, low_cut=160.0):
    """Synthetic stereo reverb impulse response: decorrelated noise decaying faster in the highs, unit energy."""
    n = int(length * SR)

    def shape(t, f):
        rt = rt60 * (damp + (1.0 - damp) / (1.0 + (f / 3500.0) ** 1.5))
        g = np.exp(-6.91 * t[:, None] / rt[None, :])
        return g * (f / np.sqrt(f * f + low_cut * low_cut))[None, :]

    ir = np.stack([shaped_noise(n, shape, rng) for _ in range(2)])
    ir = filt(ir, bell(2200, -3.0, 0.7))           # keep the reverb out of the voice's way too
    ir[:, :int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR)) ** 2
    fade(ir, 0.0, 0.05)
    ir = np.concatenate([np.zeros((2, int(predelay * SR))), ir], axis=1)
    return ir / math.sqrt((ir ** 2).sum() / 2.0)


def bake(x, ir, wet):
    """Dry one-shot plus its reverb tail, as one longer sample (trimmed where the tail falls below -70 dB)."""
    if x.ndim == 1:
        x = pan(x)
    y = wet * convolve(x, ir)
    y[:, :x.shape[1]] += x
    loud = np.flatnonzero(np.abs(y).max(axis=0) > np.abs(y).max() * 3e-4)
    y = y[:, :max(x.shape[1], loud[-1] + 1 if len(loud) else 0)]
    return fade(y, 0.0, 0.02)


def norm(x, peak=1.0):
    m = np.abs(x).max()
    return x * (peak / m) if m > 0 else x


def louden(x, target, seconds=0.3):
    """Scale a one-shot so its first `seconds` measure `target` LUFS: hits are levelled by how loud they
    sound, not by their (sub-heavy) peaks."""
    kw = kweight(x[:, :int(seconds * SR)])
    return x * 10 ** ((target - (-0.691 + 10 * np.log10((kw * kw).sum(axis=0).mean() + 1e-12))) / 20)


# -------------------------------------------------------------------------------------- wavetables

TABLE = 4096
LEVELS = np.geomspace(25.0, 20000.0, 96)           # filter cutoffs the tables are pre-rendered at
_LOG0, _DLOG = math.log(LEVELS[0]), math.log(LEVELS[1] / LEVELS[0])
_banks: dict = {}


def bank(wave, midi, res, top=1.0):
    """Band-limited single-cycle tables for one note through a four-pole resonant low-pass (a Moog-style
    ladder, unity at DC), one table per cutoff in LEVELS. top: the highest pitch ratio the note will bend to."""
    key = (wave, round(midi * 4) / 4, round(res, 2), top)
    if key not in _banks:
        f0 = float(hz(key[1]))
        kmax = int(min(TABLE // 2 - 1, 19000.0 / (f0 * top)))
        k = np.arange(1, kmax + 1, dtype=np.float64)
        if wave == "square":
            spec = np.where(k % 2 == 1, -2j * TABLE / (np.pi * k), 0)
        else:
            spec = -1j * TABLE / np.pi * (-1.0) ** (k + 1) / k
            if wave == "brass":                    # saw plus a narrow pulse: reedy, a little nasal
                spec = 0.8 * spec + 0.5 * TABLE / (np.pi * k) * np.sin(np.pi * k * 0.28)
        s = 1j * (k[None, :] * f0) / LEVELS[:, None]
        h = (1.0 + res) / ((1.0 + s) ** 4 + res)
        full = np.zeros((len(LEVELS), TABLE // 2 + 1), np.complex128)
        full[:, 1:kmax + 1] = spec[None, :] * h
        tabs = np.fft.irfft(full, TABLE, axis=1)
        _banks[key] = np.concatenate([tabs, tabs[:, :1]], axis=1).astype(np.float32)
    return _banks[key]


def wt_note(wave, midi, env, fc, res=0.5, uni=1, det=0.0, spread=0.0, rng=None, bend=None, top=1.0, drive=0.0):
    """One note: `uni` detuned voices (det cents apart at the edges) spread across the stereo field, read from
    the note's bank at cutoff fc (Hz, scalar or per sample), shaped by env; bend: per-sample semitones."""
    n = len(env)
    tabs = bank(wave, midi, res, top)
    f0 = float(hz(midi))
    lv = (np.log(np.clip(fc, LEVELS[0], LEVELS[-1] * 0.999)) - _LOG0) / _DLOG
    if np.ndim(lv) == 0:
        j = int(lv)
        row = tabs[j] * (1.0 - (lv - j)) + tabs[j + 1] * (lv - j)
    else:
        j = lv.astype(np.int32)
        w = (lv - j).astype(np.float32)
        flat, base = tabs.ravel(), j * np.int32(TABLE + 1)
    ramp = np.arange(n, dtype=np.float64) if bend is None else np.cumsum(2.0 ** (bend / 12.0))
    out = np.zeros((2, n), np.float32)
    for v in range(uni):
        x = 0.0 if uni == 1 else 2.0 * v / (uni - 1) - 1.0
        cents = x * det + (rng.uniform(-0.2, 0.2) * det if det else 0.0)
        f = f0 * 2.0 ** (cents / 1200.0)
        phase0 = rng.random() if rng is not None else 0.0
        ph = ramp * (f / SR)
        ph += phase0
        ph -= np.floor(ph)
        ph *= TABLE
        i = ph.astype(np.int32)
        fr = (ph - i).astype(np.float32)
        if np.ndim(lv) == 0:
            a = row[i]
            sig = a + (row[i + 1] - a) * fr
        else:
            b0 = base + i
            a0, a1 = flat[b0], flat[b0 + 1]
            c0, c1 = flat[b0 + TABLE + 1], flat[b0 + TABLE + 2]
            s0 = a0 + (a1 - a0) * fr
            sig = s0 + (c0 + (c1 - c0) * fr - s0) * w
        ang = (x * spread + 1.0) * math.pi / 4
        out[0] += sig * math.cos(ang)
        out[1] += sig * math.sin(ang)
    out *= (env * math.sqrt(2.0 / uni)).astype(np.float32)
    if drive:
        out = np.tanh(drive * out) / math.tanh(drive)
    return out


# ------------------------------------------------------------------------------------------- drums

def metallic(n, scale, rng):
    """Six square waves at inharmonic ratios (the classic analog cymbal recipe), built additively so nothing aliases."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 1.7 * scale:
        for k in range(1, int(20000 / f) + 1, 2):
            out += np.sin(2 * np.pi * f * k * t + rng.uniform(0, 2 * np.pi)) / k
    return out / np.abs(out).max()


def decay(n, tau, attack=0.0003):
    t = np.arange(n) / SR
    return np.exp(-t / tau) * np.minimum(1.0, t / attack if attack else 1.0)


class Kit:
    """Every drum, hit and effect, synthesized once per variant and cached (peak-normalized; levels are set in MIX)."""

    def __init__(self, seed, style):
        self.seed, self.style, self.cache = seed, style, {}
        self.room = make_ir(0.45, 0.6, 0.004, rng_for(seed, "room"), damp=0.35, low_cut=220)
        self.hall = make_ir(2.3, 2.9, 0.022, rng_for(seed, "hall"), damp=0.45)

    def get(self, name, var=0, rate=1.0):
        key = (name, var, round(rate, 3))
        if key not in self.cache:
            if key[2] != 1.0:                       # pitched up: snare builds
                x = self.get(name, var)
                pos = np.arange(0, x.shape[1] - 1, key[2])
                x = np.stack([np.interp(pos, np.arange(x.shape[1]), c) for c in x])
            else:
                x = getattr(self, "_" + name)(rng_for(self.seed, "kit", name, var))
            self.cache[key] = x.astype(np.float32)
        return self.cache[key]

    def _kick(self, r):
        soft = self.style == "brief"
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        f = 45.0 + 165.0 * np.exp(-t / 0.03) + 240.0 * np.exp(-t / 0.0035)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.16 if soft else 0.25))
        click = filt(r.standard_normal(n), highpass(2200), lowpass(8000)) * np.exp(-t / 0.0018)
        drive = 1.4 if soft else 2.4
        x = np.tanh(drive * (body + click * (0.12 if soft else 0.28))) / math.tanh(drive)
        return pan(fade(x, 0.0004, 0.03))

    def _clap(self, r):
        n = int(0.42 * SR)
        t = np.arange(n) / SR
        env = np.zeros(n)
        for k, t0 in enumerate((0.0, 0.0085, 0.017, 0.026)):
            on = np.clip((t - t0) / 0.0003, 0, 1)
            env += on * np.exp(-np.maximum(t - t0, 0) / (0.0042 if k < 3 else 0.07)) * (0.8 if k < 3 else 1.0)
        common = r.standard_normal(n)
        x = []
        for _ in range(2):
            nz = 0.75 * common + 0.35 * r.standard_normal(n)
            x.append((filt(nz, bandpass(1150, 0.85), highpass(450)) + 0.4 * filt(nz, highpass(5200))) * env)
        x = np.stack(x)
        x += 0.35 * np.sin(2 * np.pi * 205 * t) * decay(n, 0.035, 0.0005)
        return norm(bake(norm(x), self.room, 0.35))

    def _clock(self, r, pitch, side):
        n = int(0.07 * SR)
        t = np.arange(n) / SR
        x = filt(0.6 * metallic(n, pitch, r) + 0.5 * r.standard_normal(n), highpass(6000 * pitch, 0.9), bell(9800 * pitch, 5, 1.4))
        x = x / np.abs(x).max() * decay(n, 0.009 if pitch > 0.9 else 0.012, 0.0001)
        x += 0.4 * np.sin(2 * np.pi * 4400 * pitch * t) * decay(n, 0.0035, 0.0001)   # the wooden "tick"
        return norm(bake(pan(fade(x, 0.0001, 0.01), side), self.room, 0.12))

    def _tick(self, r):
        return self._clock(r, 1.0, 0.22)

    def _tock(self, r):
        return self._clock(r, 0.84, -0.22)

    def _ohat(self, r):
        n = int(0.32 * SR)
        x = filt(0.55 * metallic(n, 1.05, r) + 0.6 * r.standard_normal(n), highpass(7000, 0.8), bell(11000, 3, 1.0))
        x = x / np.abs(x).max() * decay(n, 0.085, 0.0004)
        return norm(bake(pan(fade(x, 0.0004, 0.03), 0.1), self.room, 0.15))

    def _snare(self, r):
        n = int(0.38 * SR)
        t = np.arange(n) / SR
        body = 0.7 * np.sin(2 * np.pi * np.cumsum(190 + 60 * np.exp(-t / 0.008)) / SR) * decay(n, 0.06)
        body += 0.3 * np.sin(2 * np.pi * 330 * t) * decay(n, 0.035)
        x = []
        for _ in range(2):
            wires = filt(r.standard_normal(n), highpass(1700), lowpass(10000), bell(5200, 3, 1.0)) * decay(n, 0.13)
            x.append(np.tanh(1.6 * (body + 0.75 * wires / np.abs(wires).max())))
        return norm(bake(fade(np.stack(x), 0.0003, 0.03), self.room, 0.3))

    def _drum(self, r, f0, tau, side, slap=0.35, slap_fc=1600.0, hall=0.0):
        n = int((tau * 5 + 0.1) * SR)
        t = np.arange(n) / SR
        ph = 2 * np.pi * np.cumsum(f0 * (1.0 + 0.45 * np.exp(-t / 0.035))) / SR
        body = np.sin(ph) * decay(n, tau) + 0.25 * np.sin(1.52 * ph) * decay(n, tau * 0.4)
        hit = filt(r.standard_normal(n), lowpass(slap_fc), highpass(120)) * decay(n, 0.01)
        x = np.tanh(1.8 * (body + slap * hit / np.abs(hit).max())) / math.tanh(1.8)
        x = bake(pan(fade(x, 0.0003, 0.03), side), self.room, 0.3)
        if hall:
            x = bake(x, self.hall, hall)
        return norm(x)

    def _tom_hi(self, r):
        return self._drum(r, 175, 0.16, -0.35)

    def _tom_mid(self, r):
        return self._drum(r, 128, 0.2, 0.05)

    def _tom_lo(self, r):
        return self._drum(r, 92, 0.26, 0.35)

    def _taiko(self, r):
        return self._drum(r, 66, 0.42, 0.0, slap=0.55, slap_fc=1200, hall=0.3)

    def _crash(self, r, dur=2.6):
        n = int(dur * SR)
        t = np.arange(n) / SR
        x = []
        for _ in range(2):
            freqs = np.exp(r.uniform(math.log(2800), math.log(13000), 48))
            c = np.zeros(n)
            for f, a in zip(freqs, r.uniform(0.3, 1.0, 48)):
                c += a * np.sin(2 * np.pi * f * t + r.uniform(0, 2 * np.pi)) * np.exp(-t / (1.1 * (3000 / f) ** 0.4))
            nz = filt(r.standard_normal(n), highpass(4500)) * np.exp(-t / 0.9)
            wash = filt(r.standard_normal(n), highpass(2500)) * np.exp(-t / 0.03)
            x.append(0.5 * c / np.abs(c).max() + 0.6 * nz / np.abs(nz).max() + 0.5 * wash / np.abs(wash).max())
        x = np.stack(x) * np.minimum(1.0, t / 0.001)
        return norm(bake(fade(x, 0.0005, 0.2), self.room, 0.2))

    def _boom(self, r, dur, size, crack=0.5):
        """A trailer hit: a sub drop, a thud an octave and more up (what small speakers can play), a noise
        blast and a short crack on top. size stretches the decays."""
        n = int(dur * SR)
        t = np.arange(n) / SR
        sub = np.sin(2 * np.pi * np.cumsum(40.0 + 70.0 * np.exp(-t / 0.08)) / SR) * np.exp(-t / (0.7 * size))
        thud = np.sin(2 * np.pi * np.cumsum(150.0 * (1.0 + 0.8 * np.exp(-t / 0.02))) / SR) * np.exp(-t / (0.13 * size))
        x = pan(0.6 * np.tanh(2.2 * sub) / math.tanh(2.2) + 0.55 * thud)
        for ch in range(2):
            blast = filt(r.standard_normal(n), lowpass(3500, 0.6), highpass(80))
            x[ch] += 0.6 * blast / np.abs(blast).max() * (np.exp(-t / 0.04) + 0.25 * np.exp(-t / (0.3 * size)))
            snap = filt(r.standard_normal(n), bandpass(2500, 0.7)) * np.exp(-t / 0.012)
            tip = filt(r.standard_normal(n), highpass(900, 0.6)) * np.exp(-t / 0.004)
            x[ch] += crack * (snap / np.abs(snap).max() + 0.7 * tip / np.abs(tip).max())
        return fade(x * np.minimum(1.0, t / 0.0005), 0.0005, 0.3)

    def _imp_big(self, r):
        x = self._boom(r, 3.4, 1.3)
        c = self.get("crash", 0)
        x[:, :c.shape[1]] += 0.5 * c[:, :x.shape[1]]
        return louden(bake(bake(x, self.room, 0.2), self.hall, 0.35), -6.0)

    def _imp_med(self, r):
        return louden(bake(bake(self._boom(r, 2.2, 0.8), self.room, 0.2), self.hall, 0.3), -6.0)

    def _imp_light(self, r):
        x = self._boom(r, 1.2, 0.45, crack=0.35)
        for ch in range(2):
            air = filt(r.standard_normal(x.shape[1]), highpass(5000)) * decay(x.shape[1], 0.03)
            x[ch] += 0.4 * air / np.abs(air).max()
        return louden(bake(x, self.hall, 0.25), -6.0)

    def _swell_src(self, r):
        return norm(bake(self.get("crash", 1), self.hall, 0.6))

    def swell(self, length, var=0):
        """Reverse cymbal: the start of a reverbed crash, played backwards so it peaks on the cut."""
        src = self.get("swell_src", var)
        m = min(src.shape[1], int(length * SR))
        x = src[:, :m][:, ::-1].copy()
        k = int(m * 0.4)
        x[:, :k] *= np.sin(np.linspace(0, np.pi / 2, k)) ** 2
        return fade(x, 0.0, 0.002)

    def riser(self, length, r, f_lo=300.0, f_hi=9000.0):
        """Filtered noise sweeping up, building in level, ending on the downbeat."""
        n = int(length * SR)

        def shape(t, f):
            p = np.clip(t / length, 0, 1)[:, None]
            fc = f_lo * (f_hi / f_lo) ** (p ** 1.3)
            g = np.exp(-0.5 * (np.log2(np.maximum(f, 20.0)[None, :] / fc) / 1.1) ** 2) + 0.12 * (f[None, :] > fc)
            return g * p ** 2.2

        x = np.stack([shaped_noise(n, shape, r) for _ in range(2)])
        return fade(x, 0.002, 0.004)


# ----------------------------------------------------------------------------------------- the plan

@dataclass
class Section:
    name: str
    t0: float
    t1: float = 0.0


@dataclass
class Beat:
    k: int        # index in the whole list
    t: float      # start, seconds
    p: float      # local beat length (the tempo here)
    d: float      # usable length: p, or less where a section change cuts the beat short
    sec: int      # section index
    idx: int      # beat number in its section: bar idx // 4, position idx % 4


@dataclass
class Plan:
    total: float
    bpm: float
    style: str
    sections: list
    beats: list
    cuts: list    # [(time, kind)], kind: section | bar | beat | free


TOL_SECTION, TOL_CUT = 0.035, 0.035    # how far the tempo may bend (fraction) to land on a section / a cut


def default_sections(end, bpm, cuts):
    """An energy curve for when the edit gives none: a short build, the drop, a break near the middle,
    a lift, and the final push."""
    bar = 240.0 / bpm

    def snap(t, win):
        near = [c for c in cuts if abs(c - t) <= win]
        return min(near, key=lambda c: abs(c - t)) if near else t

    if end < 2.5 * bar:
        return [(0.0, "drop")]
    drop = snap((2 if end >= 8 * bar else 1) * bar, 0.4 * bar)
    secs = [(0.0, "build"), (drop, "drop")]
    rest = end - drop
    if rest >= 12 * bar:
        brk = snap(drop + bar * round(0.45 * rest / bar), bar)
        lift = snap(brk + (4 if rest >= 20 * bar else 2) * bar, 0.5 * bar)
        final = snap(lift + (2 if rest >= 16 * bar else 1) * bar, 0.5 * bar)
        if end - final >= 2 * bar:
            secs += [(brk, "break"), (lift, "lift"), (final, "final")]
    elif rest >= 5 * bar:
        final = snap(drop + bar * max(2, round((rest - 2 * bar) / bar)), 0.5 * bar)
        if final - bar > drop + bar:
            secs += [(final - bar, "lift"), (final, "final")]
    return secs


def pick_sting(total, beat, cuts, secs):
    """Where the closing hit goes: on a late cut if there is one (the end card), else on a downbeat of the
    current grid, leaving room for the cadence and the tail."""
    ideal = total - (2 * beat + 1.9)
    lo, hi = total - (2 * beat + 3.2), total - (2 * beat + 1.3)
    if hi < 0.5:
        return max(0.0, total - 2.0) if total > 2.5 else None
    near = [c for c in cuts if lo <= c <= hi]
    if near:
        return min(near, key=lambda c: abs(c - ideal))
    ref = max([t for t, _ in secs if t < lo] or [0.0])
    best, score = None, 1e9
    for k in range(int((hi - ref) / beat) + 2):
        t = ref + k * beat
        if lo <= t <= hi and abs(t - ideal) + (0 if k % 4 == 0 else 1.5 * beat) < score:
            best, score = t, abs(t - ideal) + (0 if k % 4 == 0 else 1.5 * beat)
    return best if best is not None else max(0.5, ideal)


def make_plan(total, bpm, cuts, sections, style, end_sting) -> Plan:
    beat = 60.0 / bpm
    cuts = sorted({round(c, 4) for c in cuts if 0.05 < c < total - 0.05})
    secs = []
    for name, t in sorted(sections, key=lambda s: s[1]):
        near = [c for c in cuts if abs(c - t) < 0.06]     # picture and music change together
        secs.append((min(near, key=lambda c: abs(c - t)) if near else max(0.0, t), name))
    secs = [s for s in secs if s[0] < total - 0.5]
    sting = pick_sting(total, beat, cuts, secs) if end_sting else None
    if sting is not None:
        secs = [s for s in secs if s[0] < sting - beat]
    if not sections:
        secs = default_sections(sting if sting is not None else total, bpm, cuts)
    if not secs or secs[0][0] > 0.05:
        secs.insert(0, (0.0, "build"))
    secs[0] = (0.0, secs[0][1])
    out = []
    for t, name in secs:
        if not out or t - out[-1].t0 >= 0.75 * beat:
            out.append(Section(name, t))
    if sting is not None:
        out = [s for s in out if s.t0 < sting - 0.75 * beat] or [Section("drop", 0.0)]
        if sting > 0.05:
            out.append(Section("sting", sting))
        else:
            out = [Section("sting", 0.0)]
    for i, s in enumerate(out):
        s.t1 = out[i + 1].t0 if i + 1 < len(out) else total
    beats, anchored = timeline(out, cuts, beat)
    kinds = []
    at = {round(b.t, 6): b for b in beats}
    for c in cuts:
        if any(abs(c - s.t0) < 1e-6 for s in out):
            kinds.append((c, "section"))
        elif c in anchored:
            kinds.append((c, "bar" if at[round(c, 6)].idx % 4 == 0 else "beat"))
        else:
            kinds.append((c, "free"))
    return Plan(total, bpm, style, out, beats, kinds)


def timeline(sections, cuts, beat):
    """The beat grid. Each section starts on a downbeat; the beats in between are stretched evenly (within
    TOL_SECTION) to fit, or, when that would bend the tempo too far, run at tempo and are cut short where the
    next section slams in. Cuts that fall close to a beat then pull that beat onto the cut (within TOL_CUT)."""
    pieces = []        # [t_a, t_b, beats, free_end, section, first beat index, beat length]
    for i, s in enumerate(sections):
        nf = (s.t1 - s.t0) / beat
        n = None
        if i < len(sections) - 1:
            for step in (4, 2, 1):
                cand = step * round(nf / step)
                if cand >= 1 and abs(nf / cand - 1) <= TOL_SECTION:
                    n = cand
                    break
        if n is None:
            pieces.append([s.t0, s.t1, nf, True, i, 0, beat])
        else:
            pieces.append([s.t0, s.t1, n, False, i, 0, (s.t1 - s.t0) / n])
    anchored = set()
    for c in cuts:
        for pi, (ta, tb, n, free, sec, b0, per) in enumerate(pieces):
            if not (ta + 0.5 * per < c < tb - 0.5 * per):
                continue
            j = round((c - ta) / per)
            if j < 1 or (not free and j >= n):
                break
            p1 = (c - ta) / j
            ok = abs(p1 / beat - 1) <= TOL_SECTION and abs(p1 / per - 1) <= TOL_CUT
            if free:
                second = [c, tb, (tb - c) / p1, True, sec, b0 + j, p1]
            else:
                p2 = (tb - c) / (n - j)
                ok = ok and abs(p2 / beat - 1) <= TOL_SECTION and abs(p2 / per - 1) <= TOL_CUT
                second = [c, tb, n - j, False, sec, b0 + j, p2]
            if ok:
                pieces[pi:pi + 1] = [[ta, c, j, False, sec, b0, p1], second]
                anchored.add(c)
            break
    beats = []
    for ta, tb, n, free, sec, b0, per in pieces:
        for k in range(int(math.ceil(n - 1e-9))):
            t = ta + k * per
            if t >= tb - 0.02:
                break
            beats.append(Beat(len(beats), t, per, min(per, tb - t), sec, b0 + k))
    return beats, anchored


# ------------------------------------------------------------------------------------------ the music

KEYS = (9, 0, 2, 4, 5, 11)                     # tonic pitch class: A C D E F B minor (subs at 55-87 Hz)
PROGRESSIONS = (
    ((0, "m"), (8, "M"), (3, "M"), (10, "M")),  # i VI III VII
    ((0, "m"), (8, "M"), (5, "m"), (7, "M")),   # i VI iv V
    ((0, "m"), (10, "M"), (8, "M"), (7, "M")),  # i VII VI V
    ((0, "m"), (0, "m"), (8, "M"), (10, "M")),  # i i VI VII
)
OSTINATOS = (    # sixteenths, semitones above the chord root (root, fifth, octave: they fit every chord)
    (0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 7, 12),
    (0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 7, 0, 12, 7),
    (0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 12, 0),
)
ACCENT = (1.0, .5, .6, .9, .55, .5, .9, .55, .95, .5, .6, .9, .55, .5, .9, .6)   # 3-3-2 push: urgency
TICK = (1.0, .45, .7, .5)                       # newsroom clock: accent on the beat, tick-tock between
MOTIFS = (       # brass stabs, an A bar and a B bar: (sixteenth, velocity, length in sixteenths, top-note step)
    (((0, 1.0, 2, 0), (6, .82, 2, 0), (12, .9, 2, 1)), ((0, 1.0, 2, 0), (6, .85, 4, -1))),
    (((0, 1.0, 3, 0), (3, .75, 1, 0), (6, .88, 2, 1)), ((0, 1.0, 2, 0), (10, .78, 2, 0), (12, .9, 3, 1))),
)

LAYERS = {   # what plays in each section, and how hard: 0 = silent
    "promo": {
        "build": dict(tick=.8, ohat=0, kick=0, clap=0, taiko=1.0, ost=.9, fc=(560, 1700), sub=.75, pad=.3, stab=.85, oct=0),
        "drop": dict(tick=.9, ohat=.65, kick=1.0, clap=1.0, taiko=0, ost=1.0, fc=(1150, 1250), sub=1.0, pad=.22, stab=1.0, oct=0),
        "break": dict(tick=.55, ohat=0, kick=0, clap=0, taiko=.4, ost=.55, fc=(300, 380), sub=.5, pad=.5, stab=0, oct=0),
        "lift": dict(tick=.85, ohat=0, kick=.85, clap=0, taiko=0, ost=.9, fc=(420, 2600), sub=.8, pad=.35, stab=0, oct=0),
        "final": dict(tick=1.0, ohat=.85, kick=1.0, clap=1.0, taiko=.7, ost=1.0, fc=(1500, 1600), sub=1.0, pad=.35, stab=1.1, oct=.45),
    },
    "brief": {
        "build": dict(tick=.5, ohat=0, kick=0, clap=0, taiko=.35, ost=.7, fc=(420, 850), sub=.6, pad=.85, stab=.5, oct=0),
        "drop": dict(tick=.6, ohat=.3, kick=.6, clap=0, taiko=0, ost=.75, fc=(800, 850), sub=.8, pad=.7, stab=.45, oct=0),
        "break": dict(tick=.4, ohat=0, kick=0, clap=0, taiko=.25, ost=.45, fc=(320, 380), sub=.45, pad=.7, stab=0, oct=0),
        "lift": dict(tick=.6, ohat=0, kick=.4, clap=0, taiko=0, ost=.7, fc=(450, 1400), sub=.7, pad=.85, stab=0, oct=0),
        "final": dict(tick=.7, ohat=.4, kick=.65, clap=0, taiko=.3, ost=.85, fc=(950, 1000), sub=.85, pad=.75, stab=.55, oct=0),
    },
}

MIX = {      # linear gain per sound, applied at render time
    "promo": dict(kick=.95, clap=.75, tick=.42, tock=.42, ohat=.25, snare=.5, tom_hi=.6, tom_mid=.6, tom_lo=.6,
                  taiko=.8, crash=.3, imp_big=2.2, imp_med=1.8, imp_light=1.2, swell=.45, tswell=.6, riser=.22,
                  sub=.3, ost=.6, oct=.45, stab=.36, pad=.38, bell=.2, rise=.1, hall=.7, lufs=-16.0),
    "brief": dict(kick=.7, clap=0, tick=.3, tock=.3, ohat=.16, snare=.3, tom_hi=.4, tom_mid=.4, tom_lo=.4,
                  taiko=.5, crash=.18, imp_big=1.3, imp_med=1.1, imp_light=.8, swell=.28, tswell=.4, riser=.14,
                  sub=.26, ost=.45, oct=.3, stab=.27, pad=.45, bell=.18, rise=.07, hall=.75, lufs=-20.0),
}


@dataclass
class Note:
    patch: str     # ost | oct | stab | pad | bell | rise
    t: float
    dur: float     # gate, seconds (the release rings past it)
    midi: float
    vel: float
    fc: float = 1000.0


def chord_pcs(key, chord):
    root, q = chord
    return [(key + root + iv) % 12 for iv in (0, 3 if q == "m" else 4, 7)]


def place(pc, lo):
    """The note with pitch class pc in [lo, lo + 11]."""
    return lo + (pc - lo) % 12


def close_voicing(pcs, lo, hi, prev):
    """Three-note voicing within [lo, hi] that moves least from the previous one."""
    opts = [[m for m in range(lo, hi + 1) if m % 12 == pc] for pc in pcs]
    best, cost = None, 1e9
    for a in opts[0]:
        for b in opts[1]:
            for c in opts[2]:
                v = sorted((a, b, c))
                if v[2] - v[0] > 12:
                    continue
                d = sum(abs(x - y) for x, y in zip(v, prev)) if prev else abs(sum(v) / 3 - (lo + hi) / 2)
                if d < cost:
                    best, cost = v, d
    return best


class Arranger:
    """Turns the plan into a score: drum hits, synth notes, sub-bass spans and sidechain triggers."""

    def __init__(self, plan: Plan, seed: int):
        self.p, self.style = plan, plan.style
        r = rng_for(seed, "song")
        self.key = int(r.choice(KEYS))
        self.prog = PROGRESSIONS[int(r.integers(len(PROGRESSIONS)))]
        self.ost = OSTINATOS[int(r.integers(len(OSTINATOS)))]
        self.motif = MOTIFS[int(r.integers(len(MOTIFS)))]
        self.rng = rng_for(seed, "humanize")
        self.hits, self.notes, self.subs, self.duck, self.space = [], [], [], [], []
        self.stab_times, self.voicing, self.top = set(), None, None
        self.secbeats = [[b for b in plan.beats if b.sec == i] for i in range(len(plan.sections))]
        self.fills = {}

    # ---- helpers
    def beat_len(self, t):
        prev = [b for b in self.p.beats if b.t <= t + 1e-6]
        return prev[-1].p if prev else 60.0 / self.p.bpm

    def section_at(self, t):
        return max(i for i, s in enumerate(self.p.sections) if s.t0 <= t + 1e-6)

    def stop(self, si):
        """When the groove of section si stops: a breath (an eighth, or a sixteenth for brief) before a section that slams in."""
        secs = self.p.sections
        if si + 1 >= len(secs):
            return self.p.total + 10
        nxt = secs[si + 1]
        if nxt.name in ("drop", "final", "sting"):
            return nxt.t0 - (0.5 if self.style == "promo" else 0.25) * self.beat_len(nxt.t0 - 0.01)
        return nxt.t0

    def steps(self, si, stop):
        for b in self.secbeats[si]:
            q = b.p / 4
            for s in range(4):
                t = b.t + s * q
                if t > b.t + b.d - 0.25 * q or t >= stop - 1e-4:
                    break
                yield b, (b.idx % 4) * 4 + s, t, q

    def bars(self, si):
        out = {}
        for b in self.secbeats[si]:
            bar = b.idx // 4
            t0, t1 = out.get(bar, (b.t, b.t))
            out[bar] = (min(t0, b.t), b.t + b.d)
        return sorted((k, v[0], v[1]) for k, v in out.items())

    def chord(self, si, bar, nbars):
        name = self.p.sections[si].name
        if name == "build":
            return (0, "m")
        if name == "break":
            return self.prog[(bar // 2) % len(self.prog)]
        if name == "lift":
            return (7, "M") if bar == nbars - 1 else (8, "M")
        return self.prog[bar % len(self.prog)]

    def hit(self, name, t, vel, rate=1.0, **opt):
        if vel > 0:
            self.hits.append((name, t, vel, rate, opt))

    def stab(self, t, chord, vel, dur, step=0, top_pc=None, low=True, bell=False):
        """A brass stab chord: a close voicing, a melody note on top, the root doubled below on strong hits."""
        if vel <= 0 or any(abs(t - s) < 0.03 for s in self.stab_times):
            return
        self.stab_times.add(t)
        pcs = chord_pcs(self.key, chord)
        self.voicing = close_voicing(pcs, 52, 67, self.voicing)
        if top_pc is None:
            tones = sorted(m for m in range(64, 78) if m % 12 in pcs)
            i = min(range(len(tones)), key=lambda i: abs(tones[i] - (self.top or 69)))
            top = tones[max(0, min(len(tones) - 1, i + step))]
        else:
            top = 64 + (top_pc - 64) % 12
            if self.top and top < self.top - 6:
                top += 12
        self.top = top
        for m in self.voicing + [top]:
            self.notes.append(Note("stab", t, dur, m, vel * (1.0 if m == top else 0.8)))
        if low and vel > 0.7:
            self.notes.append(Note("stab", t, dur, place(pcs[0], 40), vel * 0.6))
        if bell:
            self.notes.append(Note("bell", t, dur, top + 12, vel * 0.8))

    def fill(self, b, kind, vel):
        q = b.p / 4
        if kind == "toms":
            for s, drum in enumerate(("tom_hi", "tom_hi", "tom_mid", "tom_lo")):
                self.hit(drum, b.t + s * q, vel * (0.7 + 0.1 * s))
        else:
            for s in range(8):
                self.hit("snare", b.t + s * q / 2, vel * (0.35 + 0.09 * s) * (1.0 if s % 2 == 0 else 0.7))

    # ---- the score
    def run(self):
        self.plan_fills()
        for si, sec in enumerate(self.p.sections):
            if sec.name == "sting":
                self.sting(si)
            else:
                self.groove(si)
            self.entrance(si)
        self.cut_hits()
        frees = [t for t, kind in self.p.cuts if kind == "free"]
        if frees:                                   # a kick a few ms off an off-grid hit would flam: drop it
            self.hits = [h for h in self.hits if h[0] != "kick" or all(not (0.012 < abs(h[1] - c) < 0.12) for c in frees)]
        marks = [t for t, _ in self.p.cuts] + [s.t0 for s in self.p.sections[1:]]
        if marks:                                   # clear hats, claps and pulse just ahead of each hit: it lands in space
            marks = np.array(marks)
            near = lambda t: ((t - marks > -0.08) & (t - marks < 0.02)).any()
            self.hits = [h for h in self.hits if h[0] not in ("tick", "tock", "ohat", "clap") or not near(h[1])]
            self.notes = [n for n in self.notes if n.patch not in ("ost", "oct") or not near(n.t)]
        self.hits.sort(key=lambda h: h[1])
        self.notes.sort(key=lambda n: n.t)
        return self

    def plan_fills(self):
        beats, secs = self.p.beats, self.p.sections
        busy = ("build", "drop", "final", "lift")
        alt = 0
        for t, kind in self.p.cuts:
            if kind != "bar":
                continue
            b = next(b for b in beats if abs(b.t - t) < 1e-6)
            if b.k and beats[b.k - 1].sec == b.sec and secs[b.sec].name in busy and beats[b.k - 1].d >= beats[b.k - 1].p * 0.99:
                self.fills[b.k - 1] = "toms" if alt % 2 == 0 else "snare"
                alt += 1
        for si, sec in enumerate(secs):
            if sec.name not in ("drop", "final"):
                continue
            bars = self.bars(si)
            last_bar = bars[-1][0] if bars else 0
            every = 4 if self.style == "promo" else 8
            for b in self.secbeats[si]:
                bar = b.idx // 4
                if b.idx % 4 == 3 and bar % every == every - 1 and bar != last_bar and b.d >= b.p * 0.99:
                    self.fills.setdefault(b.k, "toms" if alt % 2 == 0 else "snare")
                    alt += 1
            nxt = secs[si + 1].name if si + 1 < len(secs) else None
            if nxt in ("break", "sting") and self.secbeats[si]:
                b = self.secbeats[si][-1]
                if b.d >= b.p * 0.99:
                    self.fills[b.k] = "toms"

    def groove(self, si):
        sec, lay = self.p.sections[si], LAYERS[self.style][self.p.sections[si].name]
        name, promo = sec.name, self.style == "promo"
        stop = self.stop(si)
        span = max(sec.t1 - sec.t0, 1e-3)
        bars = self.bars(si)
        nbars = len(bars)
        chords = {bar: self.chord(si, bar, nbars) for bar, _, _ in bars}
        # sub bass and pad follow the harmony bar by bar
        if lay["sub"]:
            for bar, t0, t1 in bars:
                if t0 < stop:
                    self.subs.append((t0, min(t1, stop), place(chord_pcs(self.key, chords[bar])[0], 31), lay["sub"], 0.0))
        if lay["pad"]:
            spans = []
            for bar, t0, t1 in bars:
                if t0 >= stop:
                    break
                if spans and spans[-1][2] == chords[bar]:
                    spans[-1][1] = min(t1, stop)
                else:
                    spans.append([t0, min(t1, stop), chords[bar]])
            for t0, t1, ch in spans:
                pcs = chord_pcs(self.key, ch)
                root = place(pcs[0], 50)
                for m in (root, root + 7, root + 12, place(pcs[1], root + 12)):
                    self.notes.append(Note("pad", t0, t1 - t0, m, lay["pad"], 900.0 if name == "break" else 750.0))
        motif_bar = 0
        roll_from = sec.t1 - (min(span * 0.5, 2 * self.beat_len(sec.t1 - 0.01)) if name == "build" else span)
        for b, step, t, q in self.steps(si, stop):
            prog = (t - sec.t0) / span
            bar, pos, s = b.idx // 4, b.idx % 4, step % 4
            ch = chords[bar]
            filled = b.k in self.fills
            last_bar = bar == bars[-1][0]
            # newsroom clock: sixteenth ticks, louder through builds
            grow = 0.7 + 0.3 * prog if name in ("build", "lift") else 1.0
            if lay["tick"]:
                self.hit("tick" if s % 2 == 0 else "tock", t, lay["tick"] * TICK[s] * grow * self.rng.uniform(0.93, 1.05))
            if lay["ohat"] and s == 2:
                self.hit("ohat", t, lay["ohat"] * (0.85 + 0.15 * (pos % 2)))
            if s == 0 and lay["kick"] and (promo or pos in (0, 2)) and not (name == "lift" and not promo and pos not in (0, 2)):
                self.hit("kick", t, lay["kick"] * (1.0 if pos == 0 else 0.92))
                self.duck.append((t, 0.6 if promo else 0.4, 0.75 * b.p))
            if lay["clap"] and s == 0 and pos in (1, 3) and not filled:
                self.hit("clap", t, lay["clap"])
            if lay["taiko"]:
                if name == "build":
                    pat = {0: 1.0, 8: .85} if last_bar and nbars > 1 else {0: 1.0, 6: .6, 8: .85, 14: .55}
                elif name == "break":
                    pat = {0: .8} if bar % 2 == 0 else {}
                else:
                    pat = {0: .8, 8: .7, 14: .45} if bar % 2 else {0: .8, 8: .7}
                if step in pat:
                    self.hit("taiko", t, lay["taiko"] * pat[step])
                    self.duck.append((t, 0.45, 0.6 * b.p))
            if filled and s == 0:
                self.fill(b, self.fills[b.k], 0.9 if promo else 0.5)
            # rolls: snare build through a lift, a roll into the drop at the end of a build
            if name == "lift" or (name == "build" and t >= roll_from and nbars > 0 and si + 1 < len(self.p.sections)):
                rp = (t - roll_from) / max(sec.t1 - roll_from, 1e-3)
                if promo:
                    sub = 1 if rp < 0.5 and name == "lift" else (2 if rp < 0.85 else 4)
                    if s % (2 if sub == 1 else 1) == 0:
                        for k in range(max(1, sub // 2)):
                            tt = t + k * q / max(1, sub // 2)
                            self.hit("snare", tt, 0.25 + 0.7 * rp ** 1.3, rate=1.0 + 0.28 * rp)
                elif s == 0 or (rp > 0.6 and s == 2):
                    self.hit("tom_lo" if rp < 0.5 else "tom_mid", t, 0.25 + 0.4 * rp)
            # the pulse: filtered-saw sixteenths (eighths in the brief's calmer sections)
            if lay["ost"] and (promo or name == "final" or s % 2 == 0):
                fc0, fc1 = lay["fc"]
                base = fc0 + (fc1 - fc0) * prog ** 1.5
                interval = 0 if name == "build" and self.ost[step] == 7 else self.ost[step]
                root = place(chord_pcs(self.key, ch)[0], 43)
                vel = lay["ost"] * ACCENT[step]
                self.notes.append(Note("ost", t, q * (0.55 if promo else 0.8 * (2 if s % 2 == 0 and name != "final" else 1)), root + interval, vel, base))
                if lay["oct"]:
                    self.notes.append(Note("oct", t, q * 0.5, root + interval + 12, lay["oct"] * ACCENT[step], 1300.0))
            # brass stabs: the motif, an A bar then a B bar
            if lay["stab"]:
                if name == "build":
                    bar_hits = self.motif[0] if bar == 0 else (((0, .8, 2, 0),) if not last_bar or nbars == 1 else ())
                elif promo:
                    bar_hits = self.motif[bar % 2]
                else:
                    bar_hits = ((0, 1.0, 6, 0),) if (bar % 2 == 0 or name == "final") else ()
                for st, v, ln, stp in bar_hits:
                    if st == step:
                        self.stab(t, ch, lay["stab"] * v, ln * q * 0.8, step=stp)
        # risers into whatever comes next
        if si + 1 < len(self.p.sections):
            nxt = self.p.sections[si + 1]
            if name == "lift":
                self.hit("riser", sec.t0, 1.0, length=nxt.t0 - sec.t0)
                root = place(chord_pcs(self.key, (7, "M"))[0], 50)
                self.notes.append(Note("rise", sec.t0, nxt.t0 - sec.t0, root, 1.0))
            elif name == "build" and span > 1.0:
                ln = min(span - 0.25, 2 * 4 * self.beat_len(sec.t0))
                self.hit("riser", nxt.t0 - ln, 0.8 if promo else 0.5, length=ln)

    def entrance(self, si):
        """What marks the start of a section: impacts, crash, reverse swells, a breath before the big ones."""
        sec, promo = self.p.sections[si], self.style == "promo"
        name, t = sec.name, sec.t0
        prev_t = self.p.sections[si - 1].t0 if si else 0.0
        room = t - prev_t
        big = name in ("drop", "final", "sting") or si == 0
        if si == 0:
            self.hit("imp_big" if promo else "imp_med", t, 1.0 if promo else 0.7)
            self.hit("crash", t, 1.0 if promo else 0.5)
            self.duck.append((t, 0.85, 0.5))
            return
        if name == "lift":                          # a lift only gets a hit when the picture cuts there too
            if any(abs(c - t) < 1e-6 for c, _ in self.p.cuts):
                self.hit("imp_med" if promo else "imp_light", t, 0.8)
                self.hit("swell", t, 0.7, length=min(0.6, 0.8 * room))
                self.space.append((t, 0.4 if promo else 0.3, 0.22))
                self.duck.append((t, 0.7, 0.3))
            return
        imp = ("imp_big" if promo else "imp_med") if big else ("imp_med" if promo else "imp_light")
        self.hit(imp, t, 1.0 if big else 0.8)
        self.hit("crash", t, (1.0 if big else 0.55) * (1.0 if promo else 0.6))
        self.space.append((t, 0.4 if promo else 0.3, 0.3))
        self.duck.append((t, 0.85 if big else 0.7, 0.55 if big else 0.35))
        self.hit("swell", t, 1.0 if big else 0.7, length=min(1.4 if big else 0.7, 0.8 * room))
        if big and room > 0.8:
            self.hit("tswell", t, 1.0, length=min(1.6, 0.8 * room), chord=chord_pcs(self.key, (0, "m")))
        if name == "break":
            self.stab(t, (0, "m"), 0.6 if promo else 0.4, 2 * self.beat_len(t), bell=not promo)

    def cut_hits(self):
        """Every scene cut gets a hit and a reverse swell into it; on the grid it also gets a stab."""
        last = 0.0
        for t, kind in self.p.cuts:
            gap, last = t - last, t
            if kind == "section":
                continue
            si = self.section_at(t)
            name = self.p.sections[si].name
            scale = {"break": 0.7, "lift": 0.85, "sting": 0.7}.get(name, 1.0) * (1.0 if self.style == "promo" else 0.7)
            self.space.append((t, 0.5 if self.style == "promo" else 0.35, 0.22))
            if kind == "free":
                self.hit("imp_med" if gap >= 1.2 else "imp_light", t, scale * (0.75 if gap >= 1.2 else 0.9))
                self.hit("swell", t, 0.6 * scale, length=min(0.5, max(0.18, 0.45 * gap)))
                self.duck.append((t, 0.6, 0.25))
                continue
            self.hit("imp_med", t, scale * (1.0 if kind == "bar" else 0.85))
            self.hit("swell", t, 0.75 * scale, length=min(0.7, max(0.25, 0.45 * gap)))
            self.duck.append((t, 0.7, 0.3))
            if kind == "bar" and name in ("drop", "final"):
                self.hit("crash", t, 0.5 * scale)
            if name in ("drop", "final", "build"):
                b = next(b for b in self.p.beats if abs(b.t - t) < 1e-6)
                bars = self.bars(si)
                self.stab(t, self.chord(si, b.idx // 4, len(bars)), 0.9 * scale, b.p * 0.4)

    def sting(self, si):
        """Closing: a big hit, a short cadence (VI, V, i with the top line rising to the tonic), a reverb tail."""
        sec, promo = self.p.sections[si], self.style == "promo"
        t, beat = sec.t0, self.beat_len(sec.t0 - 0.01)
        room = self.p.total - t
        v = 1.0 if promo else 0.6
        self.hit("taiko", t, v)
        self.hit("kick", t, v)
        cadence = [(0.0, (0, "m"), 7, 1.0, 1.0)]
        if room >= 2 * beat + 1.0:
            cadence += [(1.0, (8, "M"), 8, .8, .45), (1.5, (7, "M"), 11, .88, .45), (2.0, (0, "m"), 0, 1.0, 1.6)]
        elif room >= beat + 0.9:
            cadence += [(1.0, (0, "m"), 0, 1.0, 1.2)]
        self.top = None
        for off, ch, top, vel, dur in cadence:
            tt = t + off * beat
            self.stab(tt, ch, vel * v, dur * beat, top_pc=(self.key + top) % 12, bell=True)
            if off == 1.0 and len(cadence) > 2:
                self.hit("tom_mid", tt, 0.7 * v)
            elif off == 1.5:
                self.hit("tom_lo", tt, 0.8 * v)
        if len(cadence) > 1:
            end = t + cadence[-1][0] * beat
            self.hit("taiko", end, v)
            self.hit("imp_med", end, 0.8 * v)
            self.hit("crash", end, 0.6 * v)
            self.duck.append((end, 0.6, 0.4))
            self.subs.append((t, end, place(self.key, 31), 0.8 * v, 0.0))
            self.subs.append((end, self.p.total, place(self.key, 31), v, 0.5))
        else:
            self.subs.append((t, self.p.total, place(self.key, 31), v, 0.5))


# --------------------------------------------------------------------------------------------- render

STEM_OF = dict(kick="kick", ost="bass", oct="bass", pad="pad", stab="stab", bell="stab", rise="fx")
SEND = dict(stab=0.22, bell=0.4, pad=0.3, rise=0.25)


def render_note(nt: Note, rng):
    t_rel = None
    if nt.patch in ("ost", "oct"):
        rel = 0.03
        n = int((nt.dur + rel) * SR)
        env = adsr(n, 0.0015, 0.09, 0.35, rel, nt.dur)
        t_rel = np.arange(n) / SR
        fc = nt.fc * (1.0 + (1.0 + 2.8 * nt.vel) * np.exp(-t_rel / 0.05))
        return wt_note("saw", nt.midi, env * nt.vel, fc, res=1.6, uni=3, det=7, spread=0.35, rng=rng, drive=1.4)
    if nt.patch == "stab":
        rel = 0.16
        n = int((nt.dur + rel) * SR)
        env = adsr(n, 0.005, 0.22, 0.5, rel, nt.dur)
        t_rel = np.arange(n) / SR
        fc = 330.0 + (900.0 + 2400.0 * nt.vel) * (1.0 - np.exp(-t_rel / 0.010)) * (0.35 + 0.65 * np.exp(-t_rel / 0.16))
        bend = -0.35 * np.exp(-t_rel / 0.025)
        return wt_note("brass", nt.midi, env * nt.vel, fc, res=0.6, uni=3, det=9, spread=0.7, rng=rng, bend=bend)
    if nt.patch == "pad":
        rel = 0.7
        n = int((nt.dur + rel) * SR)
        env = adsr(n, 0.3, 1.2, 0.85, rel, nt.dur)
        return wt_note("saw", nt.midi, env * nt.vel, nt.fc, res=0.3, uni=3, det=14, spread=0.9, rng=rng)
    if nt.patch == "bell":
        n = int((nt.dur + 1.4) * SR)
        t = np.arange(n) / SR
        f = float(hz(nt.midi))
        mod = (1.8 * np.exp(-t / 0.25) + 0.3) * np.sin(2 * np.pi * 3.5 * f * t)
        x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 0.9) + 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.4)
        return pan(fade(x * nt.vel * np.minimum(1.0, t / 0.002), 0.0, 0.05), 0.15)
    if nt.patch == "rise":
        n = int(nt.dur * SR)
        p = np.arange(n) / max(n, 1)
        env = fade(p ** 2.2 * nt.vel, 0.0, 0.004)
        return wt_note("saw", nt.midi, env, 300.0 * 40.0 ** (p ** 1.4), res=1.8, uni=5, det=16, spread=0.9,
                       rng=rng, bend=12.0 * p ** 1.6, top=2.05)
    raise ValueError(nt.patch)


def render_sub(segs, n):
    """One continuous sine (the phase never jumps) gliding between chord roots, softly saturated so phones hear it.
    Pitch and level are worked out at 1 kHz, then interpolated to the sample rate."""
    blk = 48
    nb = n // blk + 2
    f, a = np.full(nb, np.nan), np.zeros(nb)
    for t0, t1, midi, lev, tau in segs:
        i0, i1 = int(t0 * SR / blk), min(nb, int(t1 * SR / blk))
        if i1 > i0:
            f[i0:i1] = hz(midi)
            a[i0:i1] = lev * (np.exp(-np.arange(i1 - i0) * blk / SR / tau) if tau else 1.0)
    ok = ~np.isnan(f)
    if not ok.any():
        return np.zeros((2, n), np.float32)
    f[0] = f[0] if ok[0] else f[ok][0]
    f = f[np.maximum.accumulate(np.where(~np.isnan(f), np.arange(nb), 0))]
    pos = np.arange(nb) * blk
    t = np.arange(n)
    f = np.interp(t, pos, smooth(f, 0.025, SR / blk))
    a = np.interp(t, pos, smooth(a, 0.012, SR / blk))
    x = np.tanh(1.8 * np.sin(2 * np.pi * np.cumsum(f) / SR) * a) / math.tanh(1.8)
    return pan(x.astype(np.float32))


def duck_curve(n, events, lead=0.003):
    """Sidechain gain: a dip `lead` seconds ahead of every kick or hit, easing back up (smoothstep) over its release."""
    g = np.ones(n)
    pre = int(lead * SR)
    for t, depth, rel in events:
        m = int(rel * SR)
        x = np.linspace(0.0, 1.0, m)
        seg = np.concatenate([1.0 - depth * np.sin(np.linspace(0, np.pi / 2, pre)) ** 2, 1.0 - depth * (1.0 - x * x * (3 - 2 * x))])
        a = int(t * SR) - pre
        lo, hi = max(0, a), min(n, a + len(seg))
        if hi > lo:
            g[lo:hi] = np.minimum(g[lo:hi], seg[lo - a:hi - a])
    return g


def put(buf, x, t, g=1.0):
    i = int(round(t * SR))
    j = max(0, -i)
    i = max(0, i)
    m = min(x.shape[1] - j, buf.shape[1] - i)
    if m > 0:
        buf[:, i:i + m] += x[:, j:j + m].astype(np.float32, copy=False) * np.float32(g)


def render(plan: Plan, arr: Arranger, seed: int, stems_dir=None):
    n = int(round(plan.total * SR))
    size = n + 4 * SR
    mix = MIX[plan.style]
    kit = Kit(seed, plan.style)
    stems = {k: np.zeros((2, size), np.float32) for k in ("kick", "drums", "sub", "bass", "pad", "stab", "fx")}
    send = np.zeros((2, size), np.float32)
    rr = {}
    for name, t, vel, rate, opt in arr.hits:
        g = vel * mix[name]
        if name == "swell":                         # ends a hair early: the hit lands on a breath of air
            put(stems["fx"], kit.swell(opt["length"], var=len(rr) % 2), t - 0.025 - opt["length"], g)
        elif name == "riser":
            put(stems["fx"], kit.riser(opt["length"], rng_for(seed, "riser", round(t, 3))), t, g)
        elif name == "tswell":
            ln = opt["length"]
            chord = np.zeros((2, int((ln + 0.5) * SR)))
            r = rng_for(seed, "tswell", round(t, 3))
            for pc in opt["chord"]:
                for lo in (52, 64):
                    put(chord, render_note(Note("stab", 0.0, 0.3, place(pc, lo), 0.9), r), 0.0)
            wet = convolve(chord, kit.hall)[:, :int(ln * SR)][:, ::-1].copy()
            k = int(wet.shape[1] * 0.3)
            wet[:, :k] *= np.sin(np.linspace(0, np.pi / 2, k)) ** 2
            put(stems["fx"], fade(norm(wet), 0.0, 0.003), t - ln, g)
        else:
            var = rr.get(name, 0)
            rr[name] = var + 1
            nvar = 4 if name in ("tick", "tock", "snare") else 2
            x = kit.get(name, var % nvar, rate)
            stem = "kick" if name == "kick" else ("fx" if name.startswith("imp") else "drums")
            put(stems[stem], x, t, g)
    rng = rng_for(seed, "voices")
    for nt in arr.notes:
        x = render_note(nt, rng)
        put(stems[STEM_OF[nt.patch]], x, nt.t, mix[nt.patch])
        if nt.patch in SEND:
            put(send, x, nt.t, mix[nt.patch] * SEND[nt.patch])
    stems["sub"] += (render_sub(arr.subs, size) * mix["sub"]).astype(np.float32)
    duck = duck_curve(size, arr.duck).astype(np.float32)
    stems["sub"] *= duck
    stems["bass"] *= 1.0 - 0.7 * (1.0 - duck)
    stems["pad"] = (filt(stems["pad"], highpass(160, 0.7), bell(330, -2.0, 1.0)) * (1.0 - 0.8 * (1.0 - duck))).astype(np.float32)
    stems["stab"] = np.tanh(1.3 * stems["stab"]) / math.tanh(1.3)
    hall = convolve(send, kit.hall)[:, :size] * (1.0 - 0.5 * (1.0 - duck)) * mix["hall"]
    drums = compress(stems["kick"] + stems["drums"], below=4.0, ratio=3.0, attack=0.004, release=0.09)
    space = duck_curve(size, arr.space, lead=0.04)   # everything but the hits steps back as a cut lands
    out = (drums + stems["sub"] + stems["bass"] + stems["pad"] + stems["stab"] + hall) * space + stems["fx"]
    if stems_dir:
        import soundfile as sf
        stems_dir.mkdir(parents=True, exist_ok=True)
        for k, v in list(stems.items()) + [("hall", hall), ("drumbus", drums)]:
            sf.write(stems_dir / f"{k}.wav", np.asarray(v[:, :n]).T, SR, subtype="FLOAT")
    return out[:, :n].astype(np.float64)


# --------------------------------------------------------------------------------------------- master

def compress(x, below, ratio, attack, release, knee=6.0, block=32):
    """Feed-forward RMS compressor, stereo-linked, gain computed at a control rate of SR/block. The threshold
    sits `below` dB under the loud end of the material (its 95th-percentile 10 ms level), so it works on
    whatever level it is given."""
    x = np.asarray(x, dtype=np.float64)
    n = x.shape[1]
    nb = -(-n // block)
    p = np.zeros(nb * block)
    p[:n] = (x * x).mean(axis=0)
    lvl = p.reshape(nb, block).mean(axis=1)
    w = max(1, int(0.01 * SR / block))
    db = 10 * np.log10(np.convolve(lvl, np.ones(w) / w, mode="same") + 1e-12)
    live = db[db > db.max() - 60]
    over = db - (np.percentile(live, 95) - below)
    gr = np.where(over <= -knee / 2, 0.0, np.where(over >= knee / 2, (1 / ratio - 1) * over, (1 / ratio - 1) * (over + knee / 2) ** 2 / (2 * knee)))
    ca, cr = math.exp(-block / (attack * SR)), math.exp(-block / (release * SR))
    g, s = np.empty(nb), 0.0
    for i, v in enumerate(gr.tolist()):
        c = ca if v < s else cr
        s = c * s + (1 - c) * v
        g[i] = s
    return x * np.interp(np.arange(n), (np.arange(nb) + 0.5) * block, 10 ** (g / 20))


def limiter(x, ceiling, release=0.06, look=0.0025, block=16):
    """Look-ahead peak limiter: gain is the running minimum of what each block needs, released exponentially,
    then smoothed with a box as long as the look-ahead so it is already down when the peak arrives."""
    n = x.shape[1]
    nb = -(-n // block)
    pk = np.zeros(nb * block)
    pk[:n] = np.abs(x).max(axis=0)
    req = np.minimum(1.0, ceiling / np.maximum(pk.reshape(nb, block).max(axis=1), 1e-9))
    la = max(1, int(look * SR / block))
    m = np.lib.stride_tricks.sliding_window_view(np.concatenate([np.ones(2), req, np.ones(la + 2)]), la + 4)[:nb].min(axis=1)
    cr = math.exp(-block / (release * SR))
    r, s = np.empty(nb), 1.0
    for i, v in enumerate(m.tolist()):
        s = min(v, 1.0 - (1.0 - s) * cr)
        r[i] = s
    sm = np.convolve(np.concatenate([np.ones(la), r]), np.ones(la + 1) / (la + 1), mode="valid")[:nb]
    gain = np.interp(np.arange(n), (np.arange(nb) + 0.5) * block, sm)
    y = x * gain
    return np.clip(y, -ceiling, ceiling), gain


_K = (((1.53512485958697, -2.69169618940638, 1.19839281085285), (1.0, -1.69065929318241, 0.73248077421585)),
      ((1.0, -2.0, 1.0), (1.0, -1.99004745483398, 0.99007225036621)))


def _biquad(b, a):
    def h(f):
        z = np.exp(-2j * np.pi * f / SR)
        return (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    return h


def kweight(x):
    """BS.1770 K-weighting (the two biquads at 48 kHz), applied in the FFT domain."""
    return filt(x, *(_biquad(b, a) for b, a in _K), pad=8192)


def lufs(kw, gain=None):
    """Integrated loudness (BS.1770 gating) of a K-weighted signal, optionally times a gain curve."""
    e = (kw * kw).sum(axis=0)
    if gain is not None:
        e = e * gain * gain
    hop = int(0.1 * SR)
    nb = len(e) // hop
    s = e[:nb * hop].reshape(nb, hop).sum(axis=1)
    blocks = (s[:-3] + s[1:-2] + s[2:-1] + s[3:]) / (4 * hop) if nb >= 4 else np.array([e.mean()])
    lv = -0.691 + 10 * np.log10(blocks + 1e-15)
    keep = blocks[lv > -70]
    if not len(keep):
        return -70.0
    rel = -0.691 + 10 * np.log10(keep.mean()) - 10
    keep = blocks[lv > max(-70.0, rel)]
    return float(-0.691 + 10 * np.log10(keep.mean()))


def true_peak(x, taps=16):
    """Peak of the 4x oversampled signal (windowed-sinc interpolation), as a linear value."""
    k = np.arange(-taps, taps + 1)
    peak = np.abs(x).max()
    for ph in (0.25, 0.5, 0.75):
        h = np.sinc(k + ph) * np.kaiser(len(k), 8.0)
        h /= h.sum()
        for ch in x:
            peak = max(peak, np.abs(np.convolve(ch, h, mode="same")).max())
    return float(peak)


def master(x, style, sting):
    """Mono lows, voice pocket and air, glue compression, loudness to target, true-peak-safe limiting, end fade."""
    n = x.shape[1]
    m = fast_len(n + SR // 2)
    spec = np.fft.rfft(x, m)
    mid, side = (spec[0] + spec[1]) / 2, (spec[0] - spec[1]) / 2 * response(m, highpass(120, 0.7))
    eq = response(m, highpass(30, 0.7), bell(250, -1.0, 0.9), bell(2300, -3.5, 0.7), high_shelf(9500, 1.5))
    x = np.fft.irfft(np.stack([mid + side, mid - side]) * eq, m)[:, :n]
    x *= 10 ** ((-20.0 - lufs(kweight(x))) / 20)
    x = compress(x, below=3.0, ratio=2.0, attack=0.015, release=0.2)
    target = MIX[style]["lufs"]
    kw = kweight(x)
    g = 10 ** ((target - lufs(kw)) / 20)
    ceiling = 10 ** (-1.6 / 20)
    for _ in range(4):
        y, gain = limiter(x * g, ceiling)
        got = lufs(kw, g * gain)
        if abs(got - target) < 0.05:
            break
        g *= 10 ** ((target - got) / 20)
    tp = true_peak(y)
    if tp > 10 ** (-1.1 / 20):
        ceiling *= 10 ** (-1.1 / 20) / tp
        y, gain = limiter(x * g, ceiling)
    fade(y, 0.0, 0.55 if sting else 0.45)
    return y


def write_wav(path, y, seed):
    """16-bit with TPDF dither."""
    import soundfile as sf
    r = rng_for(seed, "dither")
    d = (r.random(y.shape) - r.random(y.shape)) / 32768.0
    pcm = np.clip(np.round((y + d) * 32767.0), -32768, 32767).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), pcm.T, SR, subtype="PCM_16")


# ------------------------------------------------------------------------------------------------ CLI

def parse_times(text):
    return [float(v) for v in text.replace(" ", "").split(",") if v] if text else []


def parse_sections(text):
    out = []
    for item in (text or "").replace(" ", "").split(","):
        if not item:
            continue
        name, _, t = item.partition(":")
        if name not in NAMES:
            print(f"  music: ignoring unknown section {name!r} (use {', '.join(NAMES)})", file=sys.stderr)
            continue
        out.append((name, float(t)))
    return out


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, type=Path, help="WAV file to write")
    p.add_argument("--total", required=True, type=float, help="length in seconds")
    p.add_argument("--bpm", type=float, default=132.0)
    p.add_argument("--cuts", default="", help="scene-change times in seconds, comma-separated")
    p.add_argument("--sections", default="", help="energy curve as name:time pairs, e.g. drop:3.6,break:19.2,lift:24,final:30.5")
    p.add_argument("--style", choices=("promo", "brief"), default="promo")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--end-sting", action="store_true", help="end on a hit, a short cadence and a reverb tail")
    p.add_argument("--stems", type=Path, help="also write the pre-master stems here (for inspection)")
    args = p.parse_args(argv)
    if not 1.0 <= args.total <= 900:
        p.error("--total must be between 1 and 900 seconds")
    if not 60 <= args.bpm <= 200:
        p.error("--bpm must be between 60 and 200")

    started = time.time()
    plan = make_plan(args.total, args.bpm, parse_times(args.cuts), parse_sections(args.sections), args.style, args.end_sting)
    arr = Arranger(plan, args.seed).run()
    mix = render(plan, arr, args.seed, args.stems)
    y = master(mix, args.style, plan.sections[-1].name == "sting")
    write_wav(args.out, y, args.seed)
    curve = ", ".join(f"{s.name} {s.t0:.2f}" for s in plan.sections)
    kinds = {k: sum(1 for _, x in plan.cuts if x == k) for k in ("section", "bar", "beat", "free")}
    print(f"  music: {args.total:.2f}s {args.style} at {args.bpm:g} bpm, key {'C C# D Eb E F F# G Ab A Bb B'.split()[arr.key]} minor; "
          f"{curve}; cuts {kinds}; {time.time() - started:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()

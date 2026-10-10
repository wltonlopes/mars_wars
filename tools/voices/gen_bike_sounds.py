#!/usr/bin/env python3
"""
Sons das motos (Raider dos Piratas).

  audio/actor/vehicle/engine_bike*.ogg + engine_bike.xml
      motor em movimento, tocado pelo componente VehicleSound enquanto anda.
  audio/voice/english/bike/civ_<male|female>_<grupo>*.ogg + .xml
      cada fala de audio/voice/english/civ misturada com o motor da moto
      (ronco ao selecionar, arrancada ao andar, aceleradas ao atacar,
      motor baixando ao guarnecer): a voz e a moto tocam juntas.

O motor é sintetizado (bicilíndrico em V: dois pulsos desiguais por ciclo,
mais ruído de escapamento); as falas vêm de tools/voices/gen_voices.py, que
precisa ter sido rodado antes.

Uso (na pasta do mod):  python3 tools/voices/gen_bike_sounds.py
Precisa de numpy, scipy e ffmpeg com libvorbis.
"""
import glob
import os
import subprocess
import tempfile

import numpy as np
from scipy import signal
from scipy.io import wavfile

MOD = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VOICES = os.path.join(MOD, "audio/voice/english/civ")
BIKE_VOICES = os.path.join(MOD, "audio/voice/english/bike")
ENGINE_DIR = os.path.join(MOD, "audio/actor/vehicle")
RATE = 44100

# Curvas de rotação, como pontos (segundo, rpm) ligados por retas.
RPM = {
	# Marcha lenta, uma acelerada curta e volta.
	"select": [(0, 1300), (0.35, 1300), (0.6, 4300), (0.8, 3000), (1.5, 1400), (1.8, 1300)],
	# Arrancada: sobe, troca de marcha, sobe de novo.
	"walk": [(0, 1500), (1.0, 6200), (1.08, 4300), (1.9, 5800), (2.1, 5600)],
	# Duas aceleradas fortes.
	"attack": [(0, 1600), (0.35, 6600), (0.6, 3200), (0.95, 7200), (1.5, 6400), (1.9, 6000)],
	# Chegando: o motor baixa até a marcha lenta.
	"garrison": [(0, 3800), (0.9, 1700), (1.6, 1200), (1.8, 1100)],
}
# Trechos de motor em movimento (se sobrepõem um pouco no jogo).
MOVING = [
	[(0, 4600), (0.5, 4900), (1.0, 4500), (1.5, 4700)],
	[(0, 4400), (0.4, 4300), (0.9, 4800), (1.5, 4500)],
]

# Volume do motor por baixo da fala e atraso da fala, em segundos.
ENGINE_GAIN = 0.42
VOICE_DELAY = 0.3

GROUP_XML = """<?xml version="1.0" encoding="utf-8" standalone="no" ?>
<SoundGroup>
	<Gain>1</Gain>
	<Priority>100</Priority>
	<ConeGain>1</ConeGain>
	<Looping>0</Looping>
	<RandOrder>1</RandOrder>
	<Distanceless>1</Distanceless>
	<RandGain>1</RandGain>
	<RandPitch>1</RandPitch>
	<Threshold>1</Threshold>
	<Path>audio/voice/english/bike</Path>
{sounds}</SoundGroup>
"""

ENGINE_XML = """<?xml version="1.0" encoding="utf-8" standalone="no" ?>
<SoundGroup>
	<Gain>0.6</Gain>
	<Priority>60</Priority>
	<ConeGain>1</ConeGain>
	<Looping>0</Looping>
	<RandOrder>1</RandOrder>
	<RandGain>1</RandGain>
	<GainUpper>0.6</GainUpper>
	<GainLower>0.5</GainLower>
	<RandPitch>1</RandPitch>
	<PitchUpper>1.06</PitchUpper>
	<PitchLower>0.94</PitchLower>
	<Threshold>2</Threshold>
	<Path>audio/actor/vehicle</Path>
{sounds}</SoundGroup>
"""


def band(data, low, high):
	sos = signal.butter(2, [low, high], btype="band", fs=RATE, output="sos")
	return signal.sosfilt(sos, data)


def engine(points, seed):
	"""Motor bicilíndrico em V seguindo a curva de rotação `points`."""
	rng = np.random.default_rng(seed)
	duration = points[-1][0]
	t = np.arange(int(duration * RATE)) / RATE
	rpm = np.interp(t, [p[0] for p in points], [p[1] for p in points])
	# Um pouco de irregularidade, como um motor de verdade.
	rpm *= 1 + 0.015 * np.sin(2 * np.pi * 7 * t) + 0.01 * rng.standard_normal(len(t)).cumsum() / np.sqrt(RATE)

	# Quatro tempos: cada cilindro explode a cada duas voltas.
	cycle = np.cumsum(rpm / 120.0) / RATE
	pulses = np.zeros(len(t))
	# Segundo cilindro fora de fase (intervalo desigual: o "pó-pó" do V2).
	for offset, level in ((0.0, 1.0), (0.37, 0.8)):
		phase = (cycle + offset) % 1.0
		pulses += level * np.exp(-phase * 14.0)
	pulses -= pulses.mean()

	# Escapamento: ruído que acompanha cada explosão.
	crackle = rng.standard_normal(len(t)) * (0.25 + np.clip(pulses, 0, None))
	throttle = np.clip((rpm - 1000) / 6000.0, 0, 1)
	sound = (
		1.2 * band(pulses, 40, 260) +          # corpo grave
		0.9 * band(pulses, 260, 1100) +        # ronco médio
		0.35 * band(crackle, 500, 3200) * (0.4 + throttle)
	)
	sound *= 0.55 + 0.75 * throttle
	sound = np.tanh(2.2 * sound / np.abs(sound).max())

	fade = int(0.04 * RATE)
	sound[:fade] *= np.linspace(0, 1, fade)
	sound[-fade * 3:] *= np.linspace(1, 0, fade * 3)
	return sound


def read_ogg(path, tmp):
	wav = os.path.join(tmp, "in.wav")
	subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(RATE), wav], check=True)
	return wavfile.read(wav)[1].astype(np.float64) / 32768.0


def write_ogg(path, data, tmp):
	data = data / max(1e-9, np.abs(data).max()) * 0.84
	wav = os.path.join(tmp, "out.wav")
	wavfile.write(wav, RATE, (data * 32767).astype(np.int16))
	subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", path], check=True)


def main():
	os.makedirs(BIKE_VOICES, exist_ok=True)
	os.makedirs(ENGINE_DIR, exist_ok=True)

	with tempfile.TemporaryDirectory() as tmp:
		names = []
		for n, points in enumerate(MOVING, 1):
			name = "engine_bike_%02d.ogg" % n
			write_ogg(os.path.join(ENGINE_DIR, name), engine(points, 100 + n), tmp)
			names.append(name)
		open(os.path.join(ENGINE_DIR, "engine_bike.xml"), "w", encoding="utf-8").write(
			ENGINE_XML.format(sounds="".join("\t<Sound>" + name + "</Sound>\n" for name in names)))
		print("motor em movimento: %d trechos" % len(names))

		for phenotype in ("male", "female"):
			for group, points in RPM.items():
				names = []
				voices = sorted(glob.glob(os.path.join(VOICES, "civ_%s_%s_*.ogg" % (phenotype, group))))
				if not voices:
					raise SystemExit("faltam as falas de %s/%s: rode tools/voices/gen_voices.py antes" % (phenotype, group))
				for n, voice_path in enumerate(voices, 1):
					voice = read_ogg(voice_path, tmp)
					motor = engine(points, n * 7 + len(group)) * ENGINE_GAIN
					delay = int(VOICE_DELAY * RATE)
					mix = np.zeros(max(len(motor), delay + len(voice)))
					mix[:len(motor)] += motor
					mix[delay:delay + len(voice)] += voice
					name = "civ_%s_%s_%d.ogg" % (phenotype, group, n)
					write_ogg(os.path.join(BIKE_VOICES, name), mix, tmp)
					names.append(name)
				open(os.path.join(BIKE_VOICES, "civ_%s_%s.xml" % (phenotype, group)), "w", encoding="utf-8").write(
					GROUP_XML.format(sounds="".join("\t<Sound>" + name + "</Sound>\n" for name in names)))
				print("%s %s: %d falas com motor" % (phenotype, group, len(names)))


if __name__ == "__main__":
	main()

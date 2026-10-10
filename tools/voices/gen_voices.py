#!/usr/bin/env python3
"""
Gera as falas das unidades (audio/voice/english/civ/) com voz sintetizada e
um tratamento de rádio militar, no formato de grupos de som do 0 A.D.:
civ_<male|female>_<grupo>.xml + civ_<male|female>_<grupo>_<n>.ogg.

Uso (na pasta do mod):
    python3 tools/voices/gen_voices.py <piper> <pasta dos modelos>

  <piper>             executável do Piper (https://github.com/OHF-Voice/piper1-gpl),
                      ex.: um venv com "pip install piper-tts"
  <pasta dos modelos> onde estão en_US-joe-medium.onnx e en_US-kristin-medium.onnx
                      (com os .onnx.json), de https://huggingface.co/rhasspy/piper-voices

Precisa do ffmpeg com libvorbis. As duas vozes vêm de gravações CC0 / domínio
público (joe: OHF-Voice/voice-datasets; kristin: LibriVox).

Para mudar as falas, edite LINES e rode de novo: os arquivos são regravados.
"""
import os
import subprocess
import sys
import tempfile

MOD = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(MOD, "audio/voice/english/civ")

# grupo de som do 0 A.D. -> falas (uma variação por linha).
LINES = {
	"select": ["Go ahead, commander.", "Standing by.", "Ready for orders.", "Reporting in.", "You have my attention."],
	"walk": ["Moving out.", "On my way.", "Copy that, relocating.", "Orders received.", "Rolling out."],
	"attack": ["Weapons free!", "Engaging the enemy!", "Target acquired.", "Open fire!", "Taking them down!"],
	"garrison": ["Taking cover inside.", "Entering the structure.", "Securing the position.", "Garrisoning now."],
	"gather": ["Starting extraction.", "Harvesting resources.", "Getting to work.", "Collecting supplies."],
	"build": ["Beginning construction.", "Laying the foundation.", "Building it now.", "Construction under way."],
	"repair": ["Repairs under way.", "Patching it up.", "I'll fix it.", "Starting repairs."],
	"heal": ["Medic on the way!", "Hold still, I've got you.", "Patching you up.", "Treating the wounded."],
	"collect_treasure": ["Salvaging the cache.", "Securing the supplies.", "Recovering the cargo."],
	"trade": ["Opening a trade route.", "Cargo is on the move.", "Delivering the goods."],
}

# fenótipo -> (modelo, velocidade da fala, filtro de timbre antes do rádio)
VOICES = {
	# Um pouco mais grave e seca, como um soldado no rádio.
	"male": ("en_US-joe-medium.onnx", 0.92, "asetrate=22050*0.93,aresample=44100,atempo=1.05"),
	"female": ("en_US-kristin-medium.onnx", 0.9, "aresample=44100"),
}

# Rádio militar: faixa estreita, compressão forte, leve saturação e chiado,
# com o estalo do transmissor abrindo e fechando a fala.
RADIO = (
	"[0:a]{timbre},highpass=f=320,lowpass=f=3300,"
	"acompressor=threshold=-24dB:ratio=6:attack=3:release=80:makeup=8,"
	"equalizer=f=1900:t=q:w=1:g=5,volume=2.2,asoftclip=type=tanh,"
	"silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
	"silenceremove=start_periods=1:start_threshold=-45dB,areverse[voice];"
	"anoisesrc=d=0.06:c=white:a=0.35:r=44100,highpass=f=1800,afade=t=out:st=0.03:d=0.03[open];"
	"anoisesrc=d=0.09:c=white:a=0.3:r=44100,highpass=f=1500,afade=t=out:st=0.02:d=0.07[close];"
	"[open][voice][close]concat=n=3:v=0:a=1[talk];"
	"anoisesrc=d=20:c=pink:a=0.02:r=44100,highpass=f=500,lowpass=f=3500[static];"
	"[talk][static]amix=inputs=2:duration=first:normalize=0,"
	"alimiter=limit=0.9,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=44100[out]"
)

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
	<Path>audio/voice/english/civ</Path>
{sounds}</SoundGroup>
"""


def main():
	if len(sys.argv) != 3:
		sys.exit(__doc__)
	piper, models = sys.argv[1], sys.argv[2]
	os.makedirs(OUT, exist_ok=True)

	with tempfile.TemporaryDirectory() as tmp:
		for phenotype, (model, speed, timbre) in VOICES.items():
			for group, lines in LINES.items():
				names = []
				for n, line in enumerate(lines, 1):
					wav = os.path.join(tmp, "line.wav")
					subprocess.run([piper, "-m", os.path.join(models, model), "-f", wav,
						"--length-scale", str(speed), "--sentence-silence", "0"],
						input=line.encode("utf-8"), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
					name = "civ_%s_%s_%d.ogg" % (phenotype, group, n)
					subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
						"-filter_complex", RADIO.format(timbre=timbre), "-map", "[out]",
						"-ac", "1", "-ar", "44100", "-c:a", "libvorbis", "-q:a", "4",
						os.path.join(OUT, name)], check=True)
					names.append(name)
				xml = GROUP_XML.format(sounds="".join("\t<Sound>" + name + "</Sound>\n" for name in names))
				open(os.path.join(OUT, "civ_%s_%s.xml" % (phenotype, group)), "w", encoding="utf-8").write(xml)
				print("%s %s: %d falas" % (phenotype, group, len(names)))


if __name__ == "__main__":
	main()

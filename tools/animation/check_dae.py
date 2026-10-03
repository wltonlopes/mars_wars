#!/usr/bin/env python3
"""Converte .dae com o conversor do próprio jogo (libCollada.so), para saber se
uma malha (.pmd) ou animação (.psa) carrega sem precisar abrir o 0 A.D.

Uso:  S=/snap/0ad/current; LD_LIBRARY_PATH=$S/binaries/system:$S/usr/lib/x86_64-linux-gnu \\
      python3 tools/animation/check_dae.py pmd|psa arquivo.dae [...]
"""
import ctypes
import glob
import os
import sys
import zipfile

MOD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
LOG = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p)
OUT = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint)


def find(pattern):
	found = sorted(glob.glob(pattern))
	if not found:
		sys.exit("não encontrado: " + pattern)
	return found[-1]


def skeletons():
	"""Os art/skeletons/*.xml do jogo e do mod (carregados um a um, como o jogo faz)."""
	files = []
	with zipfile.ZipFile(find("/snap/0ad/*/binaries/data/mods/public/public.zip")) as z:
		for name in sorted(z.namelist()):
			if name.startswith("art/skeletons/") and name.endswith(".xml"):
				files.append((name, z.read(name)))
	for path in sorted(glob.glob(os.path.join(MOD, "art", "skeletons", "*.xml"))):
		files.append((os.path.relpath(path, MOD), open(path, "rb").read()))
	return files


def convert(kind, paths):
	lib = ctypes.CDLL(find("/snap/0ad/*/binaries/system/libCollada.so"))
	messages = []
	logger = LOG(lambda data, severity, text: messages.append((severity, text.decode("utf-8", "replace").strip())))
	lib.set_logger(logger, None)
	for name, xml in skeletons():
		if lib.set_skeleton_definitions(xml, len(xml)) != 0:
			print("aviso: esqueleto ignorado:", name, messages[-1:])
	ok = True
	for path in paths:
		del messages[:]
		chunks = []
		writer = OUT(lambda data, text, length: chunks.append(ctypes.string_at(text, length)))
		dae = open(path, "rb").read()
		fn = lib.convert_dae_to_pmd if kind == "pmd" else lib.convert_dae_to_psa
		status = fn(dae, writer, None)
		size = sum(len(c) for c in chunks)
		print("%s %s -> %s %d bytes" % ("ok  " if status == 0 else "ERRO", os.path.relpath(path, MOD), kind, size))
		for severity, text in messages:
			if severity > 0 or status != 0:
				print("     [%d] %s" % (severity, text))
		ok = ok and status == 0
	return ok


if __name__ == "__main__":
	sys.exit(0 if convert(sys.argv[1], sys.argv[2:]) else 1)

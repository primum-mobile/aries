import os
import subprocess
from pathlib import Path


def _resource_path(*parts):
	return str(Path(__file__).resolve().parent.joinpath(*parts))


DEFAULT_EXACT_ASC_SOUND = _resource_path('Res', 'Sounds', 'Tink.aiff')


def play_sound(path=None):
	sound_path = path or DEFAULT_EXACT_ASC_SOUND
	if not os.path.exists(sound_path):
		return False

	try:
		subprocess.Popen(
			['afplay', sound_path],
			stdout=subprocess.DEVNULL,
			stderr=subprocess.DEVNULL,
		)
		return True
	except Exception:
		return False

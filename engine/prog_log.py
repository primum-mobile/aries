# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""PROG_LOG=1 progression-pipeline telemetry.

Enable with: PROG_LOG=1 python3 morinus.py
Override log path with: PROG_LOG_FILE=/tmp/some.log

Output goes to stderr AND to the file. Each line is a single timed stage.
A `Recorder` groups several stages under one root operation so the summary
line aggregates them.

Module is dependency-free (stdlib + os env) and importable from any layer.
"""

import os
import sys
import time


_ENABLED = os.environ.get('PROG_LOG', '0') not in ('', '0', 'false', 'False', 'no', 'No')
_LOG_PATH = os.environ.get('PROG_LOG_FILE', '/tmp/morinus_progressions_profile.log')


def enabled():
	return _ENABLED


def _emit(line):
	if not _ENABLED:
		return
	try:
		sys.stderr.write(line + '\n')
		sys.stderr.flush()
	except Exception:
		pass
	try:
		with open(_LOG_PATH, 'a') as f:
			f.write(line + '\n')
	except Exception:
		pass


class Recorder(object):
	"""Group several timed stages under one root op.

	Usage:
	    rec = Recorder('MINOR 0-80y')
	    with rec.stage('cheby_fit'):
	        ...
	    with rec.stage('cheby_roots'):
	        ...
	    rec.note('hits', len(rows))
	    rec.summary()   # emits one aggregate line
	"""

	__slots__ = ('label', '_stages', '_notes', '_t0')

	def __init__(self, label):
		self.label = str(label)
		self._stages = []   # list[(name, ms)]
		self._notes = []    # list[(name, value)]
		self._t0 = time.perf_counter() if _ENABLED else 0.0

	def stage(self, name):
		return _StageContext(self, name)

	def add(self, name, ms):
		if not _ENABLED:
			return
		self._stages.append((str(name), float(ms)))

	def note(self, name, value):
		if not _ENABLED:
			return
		self._notes.append((str(name), value))

	def summary(self):
		if not _ENABLED:
			return
		total_ms = (time.perf_counter() - self._t0) * 1000.0
		parts = ['%s=%.0fms' % (n, ms) for n, ms in self._stages]
		notes = ['%s=%s' % (n, v) for n, v in self._notes]
		line = 'PROG_LOG %s: %s, total=%.0fms' % (self.label, ', '.join(parts), total_ms)
		if notes:
			line += ' (' + ', '.join(notes) + ')'
		_emit(line)


class _StageContext(object):
	__slots__ = ('rec', 'name', 't0')

	def __init__(self, rec, name):
		self.rec = rec
		self.name = name
		self.t0 = 0.0

	def __enter__(self):
		if _ENABLED:
			self.t0 = time.perf_counter()
		return self

	def __exit__(self, exc_type, exc_val, exc_tb):
		if _ENABLED:
			self.rec.add(self.name, (time.perf_counter() - self.t0) * 1000.0)
		return False


def log(msg):
	"""Emit a one-off line (e.g. fallback-loop warnings)."""
	_emit('PROG_LOG ' + str(msg))

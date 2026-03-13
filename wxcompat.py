# -*- coding: utf-8 -*-
"""
wxPython compatibility helpers.

Morinus' rendering code frequently uses float coordinates/radii. wxPython on
macOS is strict and expects ints for many wx.DC drawing APIs. This module wraps
wx.DC-like objects and coerces common drawing arguments to ints.
"""


def _i(v):
	if v is None:
		return 0
	if isinstance(v, bool):
		return int(v)
	try:
		return int(round(v))
	except Exception:
		return int(v)


def _pt(p):
	try:
		return (_i(p.x), _i(p.y))
	except Exception:
		try:
			return (_i(p[0]), _i(p[1]))
		except Exception:
			return (_i(p), 0)


class CompatDC:
	def __init__(self, dc):
		self._dc = dc

	def __getattr__(self, name):
		return getattr(self._dc, name)

	def DrawCircle(self, *args):
		if len(args) == 3:
			x, y, r = args
			return self._dc.DrawCircle(_i(x), _i(y), _i(r))
		if len(args) == 2:
			p, r = args
			x, y = _pt(p)
			return self._dc.DrawCircle(x, y, _i(r))
		return self._dc.DrawCircle(*args)

	def DrawLine(self, *args):
		if len(args) == 4:
			x1, y1, x2, y2 = args
			return self._dc.DrawLine(_i(x1), _i(y1), _i(x2), _i(y2))
		if len(args) == 2:
			p1, p2 = args
			x1, y1 = _pt(p1)
			x2, y2 = _pt(p2)
			return self._dc.DrawLine(x1, y1, x2, y2)
		return self._dc.DrawLine(*args)

	def DrawLineList(self, coords, pens=None):
		fixed = [(_i(x1), _i(y1), _i(x2), _i(y2)) for (x1, y1, x2, y2) in coords]
		return self._dc.DrawLineList(fixed, pens) if pens is not None else self._dc.DrawLineList(fixed)

	def DrawArc(self, x1, y1, x2, y2, xc, yc):
		return self._dc.DrawArc(_i(x1), _i(y1), _i(x2), _i(y2), _i(xc), _i(yc))

	def DrawRectangle(self, x, y, w, h):
		return self._dc.DrawRectangle(_i(x), _i(y), _i(w), _i(h))

	def DrawPoint(self, x, y=None):
		# DrawPoint(x, y) or DrawPoint(pt)
		if y is None:
			x, y = _pt(x)
		return self._dc.DrawPoint(_i(x), _i(y))

	def DrawBitmap(self, bmp, x, y, transparent=False):
		return self._dc.DrawBitmap(bmp, _i(x), _i(y), transparent)

	def DrawText(self, text, x, y):
		return self._dc.DrawText(text, _i(x), _i(y))

	def DrawRotatedText(self, text, x, y, angle):
		return self._dc.DrawRotatedText(text, _i(x), _i(y), angle)

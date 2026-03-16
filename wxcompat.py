# -*- coding: utf-8 -*-
"""
wxPython compatibility helpers.

Morinus' rendering code frequently uses float coordinates/radii. wxPython on
macOS is strict and expects ints for many wx.DC drawing APIs. This module wraps
wx.DC-like objects and coerces common drawing arguments to ints.
"""

import wx


def get_dpi_scale(window=None):
	"""Return the display scale factor (e.g. 2.0 on Retina). Degrades to 1.0."""
	try:
		if window is not None:
			return window.GetContentScaleFactor()
	except Exception:
		pass
	try:
		return wx.GetApp().GetTopWindow().GetContentScaleFactor()
	except Exception:
		pass
	return 1.0


def create_scaled_bitmap(logical_w, logical_h, scale):
	"""Create a bitmap at physical resolution with correct logical-size metadata.

	On Retina (scale=2.0), a 600x600 logical bitmap becomes 1200x1200 physical
	pixels. SetScaleFactor tells wxPython the logical size so paint handlers
	draw it correctly without any changes.
	"""
	pw = max(1, int(logical_w * scale))
	ph = max(1, int(logical_h * scale))
	bmp = wx.Bitmap(pw, ph)
	if hasattr(bmp, 'SetScaleFactor'):
		bmp.SetScaleFactor(scale)
	return bmp


def set_bitmap_scale(bmp, scale):
	"""Apply scale factor metadata to an existing bitmap."""
	if scale != 1.0 and hasattr(bmp, 'SetScaleFactor'):
		bmp.SetScaleFactor(scale)
	return bmp


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


def _rect_dim(rect, name):
	for attr in (name, name.lower()):
		if hasattr(rect, attr):
			return _i(getattr(rect, attr))
	getter = "Get" + name
	if hasattr(rect, getter):
		return _i(getattr(rect, getter)())
	return 0


def display_client_size(window=None):
	display_index = wx.NOT_FOUND
	try:
		if window is not None:
			display_index = wx.Display.GetFromWindow(window)
	except Exception:
		display_index = wx.NOT_FOUND

	if display_index == wx.NOT_FOUND:
		try:
			if wx.Display.GetCount() > 0:
				display_index = 0
		except Exception:
			display_index = wx.NOT_FOUND

	if display_index != wx.NOT_FOUND:
		try:
			rect = wx.Display(display_index).GetClientArea()
			width = max(1, _rect_dim(rect, "Width"))
			height = max(1, _rect_dim(rect, "Height"))
			return width, height
		except Exception:
			pass

	return (1440, 900)


def scaled_window_size(window, height_ratio, default_size, min_size=(200, 200), width_cap_ratio=0.95, square=False):
	default_width, default_height = default_size
	min_width, min_height = min_size
	screen_width, screen_height = display_client_size(window)

	target_height = max(min_height, _i(screen_height * height_ratio))
	if square:
		target_width = max(min_width, target_height)
	else:
		aspect = float(default_width) / float(default_height or 1)
		target_width = max(min_width, _i(target_height * aspect))

	width_cap = max(min_width, _i(screen_width * width_cap_ratio))
	if target_width > width_cap:
		target_width = width_cap
		if square:
			target_height = max(min_height, target_width)
		else:
			target_height = max(min_height, _i(target_width / aspect))

	return target_width, target_height


def apply_frame_screen_size(frame, height_ratio, default_size, min_size=(200, 200), width_cap_ratio=0.95, square=False):
	width, height = scaled_window_size(frame, height_ratio, default_size, min_size, width_cap_ratio, square)
	frame.SetMinSize(min_size)
	frame.SetSize((width, height))
	try:
		frame.CentreOnScreen()
	except Exception:
		try:
			frame.CenterOnScreen()
		except Exception:
			pass


def place_dialog_left_of_parent(dialog, parent, gap=12):
	if dialog is None or parent is None:
		return

	try:
		parent_pos = parent.GetScreenPosition()
		parent_size = parent.GetSize()
		dialog_size = dialog.GetSize()
	except Exception:
		return

	try:
		screen_width, screen_height = display_client_size(parent)
	except Exception:
		screen_width, screen_height = (1440, 900)

	x = parent_pos.x - dialog_size.width - gap
	y = parent_pos.y + max(0, (parent_size.height - dialog_size.height) // 2)

	if x < 0:
		x = gap
	if y < 0:
		y = gap
	if x + dialog_size.width > screen_width:
		x = max(gap, screen_width - dialog_size.width - gap)
	if y + dialog_size.height > screen_height:
		y = max(gap, screen_height - dialog_size.height - gap)

	try:
		dialog.SetPosition((x, y))
	except Exception:
		pass


class ScaledFont:
	"""Wraps a PIL font so getsize/getbbox/getlength return logical units
	while the underlying font renders at physical (scaled) resolution."""

	def __init__(self, font, scale):
		self._font = font
		self._s = scale

	def __getattr__(self, name):
		return getattr(self._font, name)

	def getsize(self, text, *args, **kw):
		w, h = self._font.getsize(text, *args, **kw)
		s = self._s
		return (w / s, h / s)

	def getbbox(self, text, *args, **kw):
		bbox = self._font.getbbox(text, *args, **kw)
		s = self._s
		return (bbox[0] / s, bbox[1] / s, bbox[2] / s, bbox[3] / s)

	def getlength(self, text, *args, **kw):
		return self._font.getlength(text, *args, **kw) / self._s


class ScaledPILDraw:
	"""Wraps PIL ImageDraw so callers can use logical coordinates while the
	underlying image is at physical (scaled) resolution.  text() coords are
	multiplied by *scale*; textsize() results are divided by *scale* so that
	layout math stays in logical units."""

	def __init__(self, draw, scale):
		self._draw = draw
		self._s = scale

	def __getattr__(self, name):
		return getattr(self._draw, name)

	def text(self, xy, text, **kw):
		s = self._s
		sx, sy = xy[0] * s, xy[1] * s
		return self._draw.text((sx, sy), text, **kw)

	def textsize(self, text, font=None, *args, **kw):
		w, h = self._draw.textsize(text, font=font, *args, **kw)
		s = self._s
		return (w / s, h / s)

	def textbbox(self, xy, text, font=None, *args, **kw):
		s = self._s
		sx, sy = xy[0] * s, xy[1] * s
		left, top, right, bottom = self._draw.textbbox((sx, sy), text, font=font, *args, **kw)
		return (left / s, top / s, right / s, bottom / s)

	def line(self, xy, **kw):
		s = self._s
		scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.line(scaled, **kw)

	def rectangle(self, xy, **kw):
		s = self._s
		scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.rectangle(scaled, **kw)

	def ellipse(self, xy, **kw):
		s = self._s
		scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.ellipse(scaled, **kw)


class CompatDC:
	"""Wraps wx.DC, coercing float coords to ints.

	No coordinate scaling is done here. When the underlying bitmap has
	SetScaleFactor set, the DC natively maps logical coords to physical
	pixels — pen widths, coordinates, and everything scale automatically.
	PIL drawing (ScaledPILDraw/ScaledFont) handles its own scaling since
	PIL has no concept of bitmap scale factors.
	"""

	def __init__(self, dc, scale=1.0):
		# Wrap in GCDC for anti-aliased drawing (smooth lines/circles)
		try:
			gcdc = wx.GCDC(dc)
			# Set highest quality anti-aliasing on the graphics context
			gc = gcdc.GetGraphicsContext()
			if gc is not None:
				gc.SetAntialiasMode(wx.ANTIALIAS_DEFAULT)
				gc.SetInterpolationQuality(wx.INTERPOLATION_BEST)
			dc = gcdc
		except Exception:
			pass
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
		if y is None:
			x, y = _pt(x)
		return self._dc.DrawPoint(_i(x), _i(y))

	def DrawBitmap(self, bmp, x, y, transparent=False):
		return self._dc.DrawBitmap(bmp, _i(x), _i(y), transparent)

	def DrawText(self, text, x, y):
		return self._dc.DrawText(text, _i(x), _i(y))

	def DrawRotatedText(self, text, x, y, angle):
		return self._dc.DrawRotatedText(text, _i(x), _i(y), angle)

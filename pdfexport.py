# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import math
import os
import tempfile

import wx

import common
import mtexts
import wxcompat


class PDFExportError(Exception):
	pass


_REGISTERED_FONTS = None
_PRINT_BACKGROUND = (255, 255, 255)
_PRINT_TEXT = (24, 24, 24)
_PRINT_GRID = (205, 205, 205)
_PRINT_OUTLINE = (120, 120, 120)


def _reportlab():
	try:
		from reportlab.lib import pagesizes
		from reportlab.pdfbase import pdfmetrics
		from reportlab.pdfbase.ttfonts import TTFont
		from reportlab.pdfgen import canvas
	except Exception as exc:
		raise PDFExportError('PDF export requires ReportLab. Install project requirements and try again.') from exc
	return pagesizes, pdfmetrics, TTFont, canvas


def _platypus():
	"""Lazy-import the Platypus flowable layout API.

	Platypus owns multi-page tables, auto wrapping, and repeating headers — the
	low-level pdfgen.canvas API used by export_paginated_table_to_pdf() has to
	compute rows-per-page manually and breaks the moment a cell needs to wrap.
	Reference: https://docs.reportlab.com/reportlab/userguide/ch5_paragraphs/
	and https://docs.reportlab.com/reportlab/userguide/ch7_tables/ .
	"""
	try:
		from reportlab.lib import colors
		from reportlab.lib.styles import ParagraphStyle
		from reportlab.lib.units import inch
		from reportlab.platypus import (
			BaseDocTemplate,
			Frame,
			LongTable,
			PageTemplate,
			Paragraph,
			Spacer,
			TableStyle,
		)
	except Exception as exc:
		# Diagnostic: include the actual failing import + Python path so a
		# bundled-app PyInstaller miss (the typical cause) is obvious from
		# the error text instead of generic "install requirements".
		import sys as _sys
		raise PDFExportError(
			'PDF export requires ReportLab Platypus (%s: %s). Python: %s. '
			'If you are running the bundled .app, rebuild with `make my-app` '
			'after updating Morinus.macos.spec hidden imports.' % (
				type(exc).__name__, exc, _sys.executable,
			)
		) from exc
	return {
		'colors': colors,
		'ParagraphStyle': ParagraphStyle,
		'inch': inch,
		'BaseDocTemplate': BaseDocTemplate,
		'Frame': Frame,
		'LongTable': LongTable,
		'PageTemplate': PageTemplate,
		'Paragraph': Paragraph,
		'Spacer': Spacer,
		'TableStyle': TableStyle,
	}


def is_vector_pdf_supported(wnd):
	return (
		callable(getattr(wnd, 'export_pdf_document', None)) or
		callable(getattr(wnd, 'export_pdf_draw', None)) or
		callable(getattr(wnd, 'pdf_export_spec', None)) or
		callable(getattr(wnd, '_drawDC', None))
	)


def chart_subtitle_line(chrt):
	"""Best-effort 'Name · YYYY-MM-DD HH:MM · place' subtitle for table PDFs.

	Returns an empty string if no usable identifier is on the chart; callers
	can drop it from the header list.
	"""
	if chrt is None:
		return ''
	parts = []
	name = getattr(chrt, 'name', None)
	if name:
		parts.append(str(name))
	try:
		t = chrt.time
		parts.append('%d-%02d-%02d %02d:%02d' % (
			int(t.year), int(t.month), int(t.day),
			int(t.hour), int(t.minute),
		))
	except Exception:
		pass
	try:
		place = chrt.place.placename
		if place:
			parts.append(str(place))
	except Exception:
		pass
	return ' · '.join(parts)


def export_window_spec_to_pdf(wnd, path):
	"""Drive a Platypus table PDF from a window's pdf_export_spec().

	Windows that want a clean, wrapping, auto-paginated table PDF can simply
	implement ``pdf_export_spec(self)`` returning a dict with keys:

	    {
	        'title':        str — required (used in metadata + as H1),
	        'columns':      list of {'label': str|cellspec,
	                                 'width': float (relative weight),
	                                 'align': 'L'/'C'/'R'},
	        'rows':         iterable of row-cell-lists (cells may be plain
	                        strings, (role, text[, color]) tuples, lists of
	                        such tuples for mixed-font runs, or namedtuple
	                        _Part(text, font, color, gap) — see
	                        _cell_to_paragraph_markup),
	        'header_lines': optional list of subtitle strings,
	        'page_size':    optional 'auto' / 'portrait' / 'landscape',
	        'subject':      optional PDF metadata Subject string,
	    }

	One-call vector PDF — no per-window canvas math, no row-height precompute.
	"""
	spec = wnd.pdf_export_spec()
	if not isinstance(spec, dict):
		raise PDFExportError('pdf_export_spec() must return a dict.')
	return export_table_document(
		path,
		spec.get('title') or getattr(getattr(wnd, 'chart', None), 'name', 'Aries Export') or 'Aries Export',
		spec.get('columns') or [],
		spec.get('rows') or [],
		header_lines=spec.get('header_lines'),
		page_size=spec.get('page_size', 'auto'),
		font_size=spec.get('font_size', 9.0),
		header_font_size=spec.get('header_font_size', 10.0),
		header_fill=spec.get('header_fill', (232, 232, 232)),
		grid_color=spec.get('grid_color', (180, 180, 180)),
		zebra=spec.get('zebra', True),
		subject=spec.get('subject'),
	)


def _resource_base_dir():
	override = os.environ.get('ARIES_DAEMON_BASE_DIR', '').strip()
	if override:
		return override
	return os.path.dirname(os.path.abspath(__file__))


def _existing_or_default(path, fallback):
	if path and os.path.exists(path):
		return path
	return fallback


def _font_paths():
	cc = getattr(common, 'common', None)
	base = _resource_base_dir()
	defaults = {
		'text': os.path.join(base, 'Res', 'FreeSans.ttf'),
		'bold': os.path.join(base, 'Res', 'FreeSansBold.ttf'),
		'symbol': os.path.join(base, 'Res', 'Morinus.ttf'),
	}
	return {
		'text': _existing_or_default(getattr(cc, 'abc', None), defaults['text']),
		'bold': _existing_or_default(getattr(cc, 'abc_bold', None), defaults['bold']),
		'symbol': _existing_or_default(getattr(cc, 'symbols', None), defaults['symbol']),
	}


def _ensure_registered_fonts():
	global _REGISTERED_FONTS
	if _REGISTERED_FONTS is not None:
		return _REGISTERED_FONTS

	_pagesizes, pdfmetrics, TTFont, _canvas = _reportlab()
	paths = _font_paths()
	registered = {}
	for role, path in paths.items():
		name = 'MorinusPDF-%s' % role
		if not os.path.exists(path):
			raise PDFExportError('Missing bundled font for PDF export: %s' % path)
		try:
			pdfmetrics.registerFont(TTFont(name, path))
		except Exception:
			# ReportLab raises if the same font name is registered twice.
			pass
		registered[role] = name
	_REGISTERED_FONTS = registered
	return registered


class PDFFont:
	def __init__(self, role, size):
		_pagesizes, pdfmetrics, _TTFont, _canvas = _reportlab()
		names = _ensure_registered_fonts()
		self.pdf_name = names[role]
		self.size = max(1.0, float(size))
		self._pdfmetrics = pdfmetrics
		try:
			self.ascent = pdfmetrics.getAscent(self.pdf_name, self.size)
			self.descent = pdfmetrics.getDescent(self.pdf_name, self.size)
		except Exception:
			self.ascent = self.size * 0.8
			self.descent = -self.size * 0.2
		self.height = max(1.0, self.ascent - self.descent)
		self._cache = {}

	def getsize(self, text):
		text = str(text)
		cached = self._cache.get(text)
		if cached is not None:
			return cached
		try:
			width = self._pdfmetrics.stringWidth(text, self.pdf_name, self.size)
		except Exception:
			width = len(text) * self.size * 0.5
		result = (width, self.height)
		self._cache[text] = result
		return result

	def getlength(self, text):
		return self.getsize(text)[0]

	def getbbox(self, text):
		width, height = self.getsize(text)
		return (0, 0, width, height)


def _font_role(attr):
	lattr = attr.lower()
	if any(token in lattr for token in ('mor', 'sym', 'sign', 'aspect', 'planet')):
		return 'symbol'
	if 'bold' in lattr:
		return 'bold'
	return 'text'


def _font_size(font, fallback=16):
	try:
		value = getattr(font, 'size')
		if value:
			return value
	except Exception:
		pass
	try:
		return font.GetPointSize()
	except Exception:
		return fallback


def _pdf_fonts_for_window(wnd):
	result = {}
	fallback = int(getattr(wnd, 'FONT_SIZE', getattr(wnd, 'FONT_S', 16)))
	for attr in list(getattr(wnd, '__dict__', {})):
		if not (attr.startswith('fnt') or attr.startswith('f_')):
			continue
		font = getattr(wnd, attr, None)
		if font is None:
			continue
		result[attr] = PDFFont(_font_role(attr), _font_size(font, fallback))
	return result


def _install_pdf_dc_fonts(wnd):
	orig = {}
	for attr, font in _pdf_fonts_for_window(wnd).items():
		dc_attr = '_dc_' + attr
		orig[dc_attr] = getattr(wnd, dc_attr, None)
		setattr(wnd, dc_attr, font)
	return orig


def _install_pdf_direct_fonts(wnd):
	orig = {}
	for attr, font in _pdf_fonts_for_window(wnd).items():
		orig[attr] = getattr(wnd, attr, None)
		setattr(wnd, attr, font)
	return orig


def _restore_attrs(wnd, attrs):
	for attr, value in attrs.items():
		if value is None:
			try:
				delattr(wnd, attr)
			except Exception:
				pass
		else:
			setattr(wnd, attr, value)


def _rgb(color, default=(0, 0, 0)):
	if color is None:
		color = default
	try:
		if hasattr(color, 'Get'):
			color = color.Get()
		return tuple(max(0, min(255, int(v))) for v in color[:3])
	except Exception:
		return default


class ReportLabDraw:
	def __init__(self, canvas, page_height, left, top, scale, y_offset, visible_height):
		self.canvas = canvas
		self.page_height = float(page_height)
		self.left = float(left)
		self.top = float(top)
		self.scale = float(scale)
		self.y_offset = float(y_offset)
		self.visible_y0 = float(y_offset)
		self.visible_y1 = float(y_offset + visible_height)

	def _set_fill(self, color):
		r, g, b = _rgb(color)
		self.canvas.setFillColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _set_stroke(self, color):
		r, g, b = _rgb(color)
		self.canvas.setStrokeColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _set_print_text(self):
		r, g, b = _PRINT_TEXT
		self.canvas.setFillColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _set_print_grid(self):
		r, g, b = _PRINT_GRID
		self.canvas.setStrokeColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _set_print_outline(self):
		r, g, b = _PRINT_OUTLINE
		self.canvas.setStrokeColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _set_print_background(self):
		r, g, b = _PRINT_BACKGROUND
		self.canvas.setFillColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _set_print_shape_fill(self):
		r, g, b = _PRINT_TEXT
		self.canvas.setFillColorRGB(r / 255.0, g / 255.0, b / 255.0)

	def _x(self, x):
		return self.left + float(x) * self.scale

	def _ytop(self, y):
		return self.top - (float(y) - self.y_offset) * self.scale

	def _visible(self, y1, y2):
		lo = min(float(y1), float(y2))
		hi = max(float(y1), float(y2))
		return hi >= self.visible_y0 and lo <= self.visible_y1

	def text(self, xy, text, fill=None, font=None, **kw):
		if font is None or not text:
			return
		text = str(text)
		x, y = float(xy[0]), float(xy[1])
		width, height = self.textsize(text, font)
		if not self._visible(y, y + height):
			return
		pdf_name = getattr(font, 'pdf_name', None)
		if pdf_name is None:
			return
		size = float(getattr(font, 'size', 12.0)) * self.scale
		ascent = float(getattr(font, 'ascent', size * 0.8))
		self.canvas.setFont(pdf_name, size)
		self._set_print_text()
		self.canvas.drawString(self._x(x), self._ytop(y) - ascent * self.scale, text)

	def textsize(self, text, font=None, *args, **kw):
		if font is None or not text:
			return (0, 0)
		if hasattr(font, 'getsize'):
			return font.getsize(str(text))
		return (0, 0)

	def textbbox(self, xy, text, font=None, *args, **kw):
		x, y = float(xy[0]), float(xy[1])
		if font is not None and hasattr(font, 'getbbox'):
			l, t, r, b = font.getbbox(str(text))
			return (x + l, y + t, x + r, y + b)
		w, h = self.textsize(text, font)
		return (x, y, x + w, y + h)

	def line(self, xy, fill=None, width=1, **kw):
		if xy and isinstance(xy[0], (int, float)):
			x1, y1, x2, y2 = xy[0], xy[1], xy[2], xy[3]
		else:
			(x1, y1), (x2, y2) = xy[0], xy[1]
		if not self._visible(y1, y2):
			return
		self._set_print_grid()
		self.canvas.setLineWidth(max(0.25, float(width) * self.scale))
		self.canvas.line(self._x(x1), self._ytop(y1), self._x(x2), self._ytop(y2))

	def rectangle(self, xy, fill=None, outline=None, width=1, **kw):
		if xy and isinstance(xy[0], (int, float)):
			x1, y1, x2, y2 = xy[0], xy[1], xy[2], xy[3]
		else:
			(x1, y1), (x2, y2) = xy[0], xy[1]
		if not self._visible(y1, y2):
			return
		x = self._x(x1)
		y = self._ytop(y2)
		w = (float(x2) - float(x1)) * self.scale
		h = (float(y2) - float(y1)) * self.scale
		if fill is not None:
			self._set_print_background()
			self.canvas.rect(x, y, w, h, stroke=0, fill=1)
		if outline is not None:
			self._set_print_grid()
			self.canvas.setLineWidth(max(0.25, float(width) * self.scale))
			self.canvas.rect(x, y, w, h, stroke=1, fill=0)

	def polygon(self, xy, fill=None, outline=None, width=1, **kw):
		if not xy:
			return
		ys = [point[1] for point in xy]
		if not self._visible(min(ys), max(ys)):
			return
		path = self.canvas.beginPath()
		first = True
		for x, y in xy:
			if first:
				path.moveTo(self._x(x), self._ytop(y))
				first = False
			else:
				path.lineTo(self._x(x), self._ytop(y))
		path.close()
		if fill is not None:
			self._set_print_shape_fill()
		if outline is not None:
			self._set_print_outline()
			self.canvas.setLineWidth(max(0.25, float(width) * self.scale))
		self.canvas.drawPath(path, stroke=1 if outline is not None else 0, fill=1 if fill is not None else 0)


class PDFDCStub:
	def __init__(self, draw):
		self.draw = draw
		self.brush = None
		self.pen = None

	def SetBrush(self, brush):
		self.brush = brush

	def SetPen(self, pen):
		self.pen = pen

	def DrawRectangle(self, x, y, w, h):
		fill = None
		if self.brush is not None and self.brush is not wx.TRANSPARENT_BRUSH:
			try:
				fill = self.brush.GetColour().Get()
			except Exception:
				fill = None
		outline = None
		if self.pen is not None and self.pen is not wx.TRANSPARENT_PEN:
			try:
				outline = self.pen.GetColour().Get()
			except Exception:
				outline = None
		self.draw.rectangle((x, y, x + w, y + h), fill=fill, outline=outline)


def _logical_size(wnd):
	width = int(getattr(wnd, 'WIDTH', 0) or 0)
	height = int(getattr(wnd, 'HEIGHT', 0) or 0)
	if width <= 0 or height <= 0:
		try:
			size = wnd.GetVirtualSize()
			width = max(width, int(size.width))
			height = max(height, int(size.height))
		except Exception:
			pass
	if width <= 0:
		width = int(getattr(wnd, 'TABLE_WIDTH', 640)) + 40
	if height <= 0:
		height = int(getattr(wnd, 'TABLE_HEIGHT', 480)) + 40
	return max(1, width), max(1, height)


def _page_geometry(content_width, content_height):
	pagesizes, _pdfmetrics, _TTFont, _canvas = _reportlab()
	margin = 36.0
	portrait = pagesizes.letter
	landscape = pagesizes.landscape(portrait)

	def scale_for(page):
		area_w = page[0] - 2 * margin
		return min(1.0, area_w / max(1.0, float(content_width)))

	portrait_scale = scale_for(portrait)
	landscape_scale = scale_for(landscape)
	page = landscape if landscape_scale > portrait_scale + 0.05 else portrait
	scale = scale_for(page)
	area_w = page[0] - 2 * margin
	area_h = page[1] - 2 * margin
	left = margin + max(0.0, (area_w - content_width * scale) / 2.0)
	top = page[1] - margin
	page_logical_h = max(1.0, area_h / max(scale, 0.01))
	return page, margin, left, top, scale, page_logical_h


def _bitmap_page_geometry(content_width, content_height):
	pagesizes, _pdfmetrics, _TTFont, _canvas = _reportlab()
	margin = 36.0
	portrait = pagesizes.letter
	landscape = pagesizes.landscape(portrait)

	def fit_for(page):
		area_w = page[0] - 2 * margin
		area_h = page[1] - 2 * margin
		scale = min(
			1.0,
			area_w / max(1.0, float(content_width)),
			area_h / max(1.0, float(content_height)),
		)
		image_w = float(content_width) * scale
		image_h = float(content_height) * scale
		left = margin + max(0.0, (area_w - image_w) / 2.0)
		top = page[1] - margin - max(0.0, (area_h - image_h) / 2.0)
		return page, margin, left, top, scale

	portrait_fit = fit_for(portrait)
	landscape_fit = fit_for(landscape)
	portrait_scale = portrait_fit[4]
	landscape_scale = landscape_fit[4]
	aspect = float(content_width) / max(1.0, float(content_height))
	if aspect > 1.15 and landscape_scale > portrait_scale + 0.01:
		return landscape_fit
	return portrait_fit


def export_paginated_table_to_pdf(
	wnd,
	path,
	row_start,
	row_stop,
	table_width,
	header_height,
	row_height,
	draw_header,
	draw_row,
	border=20,
	title=None,
):
	_pagesizes, _pdfmetrics, _TTFont, canvas = _reportlab()
	content_width = max(1, int((2 * border) + table_width))
	page, margin, left, top, scale, page_logical_h = _page_geometry(content_width, 1)
	available_rows_h = max(1.0, page_logical_h - (2 * border) - header_height)
	rows_per_page = max(1, int(available_rows_h / max(1.0, float(row_height))))
	row_count = max(0, int(row_stop) - int(row_start))
	page_count = max(1, int(math.ceil(row_count / float(rows_per_page))))
	doc = canvas.Canvas(path, pagesize=page)
	try:
		doc.setTitle(title or getattr(getattr(wnd, 'chart', None), 'name', 'Morinus Table Export') or 'Morinus Table Export')
	except Exception:
		pass

	orig = _install_pdf_direct_fonts(wnd)
	try:
		for page_index in range(page_count):
			first_row = int(row_start) + (page_index * rows_per_page)
			last_row = min(int(row_stop), first_row + rows_per_page)
			rows_on_page = max(0, last_row - first_row)
			table_height = header_height + (rows_on_page * row_height)
			draw = ReportLabDraw(doc, page[1], left, top, scale, 0, page_logical_h)
			dc = PDFDCStub(draw)
			doc.saveState()
			path_obj = doc.beginPath()
			path_obj.rect(margin, margin, page[0] - 2 * margin, page[1] - 2 * margin)
			doc.clipPath(path_obj, stroke=0, fill=0)
			draw.rectangle((0, 0, content_width, page_logical_h), fill=_PRINT_BACKGROUND)
			draw_header(draw, dc, table_height, page_index + 1, page_count, first_row, last_row)
			y = border + header_height
			for row_idx in range(first_row, last_row):
				draw_row(draw, dc, y, row_idx)
				y += row_height
			doc.restoreState()
			doc.showPage()
	finally:
		_restore_attrs(wnd, orig)
	doc.save()
	return True


def _role_to_pdf_font(role):
	"""Map a window-side font role to a registered PDF font name."""
	names = _ensure_registered_fonts()
	if role in ('morinus', 'symbol', 'aspects', 'glyph'):
		return names['symbol']
	if role == 'bold':
		return names['bold']
	return names['text']


def _escape_paragraph_text(s):
	"""Escape XML metacharacters so Platypus Paragraph treats the text literally.

	Paragraph parses its content as mini-XML (so <font>, <b>, <i> work). Any &,
	<, > in user data has to be escaped or Paragraph will raise.
	"""
	if s is None:
		return ''
	return (
		str(s)
		.replace('&', '&amp;')
		.replace('<', '&lt;')
		.replace('>', '&gt;')
	)


def _color_attr(color):
	if color is None:
		return ''
	r, g, b = _rgb(color)
	return ' color="#%02x%02x%02x"' % (r, g, b)


def _cell_to_paragraph_markup(cell):
	"""Convert one cell spec into Paragraph-friendly XML markup.

	Accepted cell shapes:
	    None / ''                       — empty cell
	    'plain text'                    — single text run
	    ('role', 'text')                — single run in the given font role
	    ('role', 'text', color)         — single run with explicit color
	    [(role, text[, color]), ...]    — multiple runs concatenated; each run
	                                      uses its own font + optional color
	    [_Part-like(text, font, color, gap)]
	                                    — supports the namedtuple shape used by
	                                      primdirslistwnd._build_row_display
	"""
	if cell is None:
		return ''
	# Plain string
	if isinstance(cell, str):
		return _escape_paragraph_text(cell)
	# List/tuple of runs
	if isinstance(cell, (list, tuple)):
		# Single tuple of (role, text[, color]) — not a list of runs
		if (
			cell and not isinstance(cell[0], (list, tuple))
			and not hasattr(cell[0], 'font')
			and isinstance(cell[0], str)
		):
			runs = [cell]
		else:
			runs = list(cell)
		fragments = []
		last_index = len(runs) - 1
		for i, run in enumerate(runs):
			if run is None:
				continue
			# _Part-like namedtuple
			if hasattr(run, 'font') and hasattr(run, 'text'):
				text = getattr(run, 'text', '')
				role = getattr(run, 'font', 'text')
				color = getattr(run, 'color', None)
				gap = bool(getattr(run, 'gap', False))
			else:
				if len(run) == 2:
					role, text = run
					color = None
				elif len(run) >= 3:
					role, text, color = run[0], run[1], run[2]
				else:
					continue
				gap = False
			if not text:
				continue
			font_name = _role_to_pdf_font(role)
			fragments.append(
				'<font name="%s"%s>%s</font>' % (
					font_name,
					_color_attr(color),
					_escape_paragraph_text(text),
				)
			)
			if gap and i < last_index:
				fragments.append(' ')
		return ''.join(fragments)
	# Fallback: stringify
	return _escape_paragraph_text(cell)


def export_table_document(
	path,
	title,
	columns,
	rows,
	header_lines=None,
	page_size='auto',
	font_size=9.0,
	header_font_size=10.0,
	header_fill=(232, 232, 232),
	grid_color=(180, 180, 180),
	zebra=True,
	subject=None,
):
	"""Export a wrapping, paginating, multi-cell-font table via Platypus.

	This is the recommended path for any *data-driven* table where:
	    * cells can be long enough to wrap onto multiple lines, and
	    * row count is large enough to overflow onto multiple pages.

	It uses reportlab.platypus.LongTable so the table splits across pages with
	a repeating header row, reportlab.platypus.Paragraph cells so text wraps
	inside cells with proper line breaks, and the Aries-bundled fonts via the
	existing _ensure_registered_fonts() registration so Morinus glyphs render
	natively inside table cells (no PNG fallbacks).

	Parameters
	----------
	path : str
	    Destination .pdf path.
	title : str
	    Document title (also used as the PDF metadata title and the H1 above
	    the table).
	columns : list of dict
	    One entry per column: {'label': str, 'width': float, 'align': 'L'/'C'/'R'}
	    'width' is a relative weight; the table is scaled to the printable
	    page width. 'label' may itself be a cell spec (string / tuple / list).
	rows : iterable of cell-list
	    Each row is a list whose length matches ``columns``. Each cell may be a
	    plain string, a (role, text[, color]) tuple, or a list of such tuples
	    for mixed-font runs in one cell. See _cell_to_paragraph_markup.
	header_lines : list of str, optional
	    Extra context lines (chart name, native, key + method, etc.) printed
	    above the table on the first page.
	page_size : 'auto' | 'portrait' | 'landscape'
	    'auto' chooses landscape when the table is wider than ~7" portrait.
	font_size, header_font_size : float
	    Point sizes for body / header rows.
	header_fill, grid_color : (r, g, b)
	    Header background and grid color.
	zebra : bool
	    Alternate row background fill for readability.
	subject : str, optional
	    PDF metadata Subject (defaults to title).
	"""
	pl = _platypus()
	pagesizes, _pdfmetrics, _TTFont, _canvas = _reportlab()
	font_names = _ensure_registered_fonts()

	# Serve-time localization of the module's own user-facing literals (the
	# document-title fallback and the page-footer word). Caller-supplied title /
	# columns / rows / header_lines are already localized upstream.
	default_title = mtexts.txts.get('AriesTableExport', 'Aries Table Export')
	page_word = mtexts.txts.get('Page', 'page')

	if not columns:
		raise PDFExportError('Cannot export a table with no columns.')
	col_count = len(columns)

	# Page selection — landscape when many/wide columns.
	portrait = pagesizes.letter
	landscape = pagesizes.landscape(portrait)
	if page_size == 'portrait':
		page = portrait
	elif page_size == 'landscape':
		page = landscape
	else:
		total_weight = sum(max(0.01, float(c.get('width', 1.0))) for c in columns)
		# Heuristic: > 5 weighted columns or > 5 actual columns → landscape.
		page = landscape if (col_count >= 6 or total_weight > 5.5) else portrait

	margin = 0.5 * pl['inch']
	printable_w = page[0] - 2 * margin
	printable_h = page[1] - 2 * margin

	# Resolve column widths from relative weights.
	weights = [max(0.01, float(c.get('width', 1.0))) for c in columns]
	wsum = sum(weights)
	col_widths = [printable_w * (w / wsum) for w in weights]

	body_style = pl['ParagraphStyle'](
		name='MorinusTableBody',
		fontName=font_names['text'],
		fontSize=float(font_size),
		leading=float(font_size) * 1.25,
		textColor=pl['colors'].HexColor('#181818'),
	)
	header_style = pl['ParagraphStyle'](
		name='MorinusTableHeader',
		fontName=font_names['bold'],
		fontSize=float(header_font_size),
		leading=float(header_font_size) * 1.25,
		textColor=pl['colors'].HexColor('#181818'),
		alignment=1,  # center
	)
	title_style = pl['ParagraphStyle'](
		name='MorinusTitle',
		fontName=font_names['bold'],
		fontSize=14.0,
		leading=17.0,
		spaceAfter=4.0,
		textColor=pl['colors'].HexColor('#181818'),
	)
	subtitle_style = pl['ParagraphStyle'](
		name='MorinusSubtitle',
		fontName=font_names['text'],
		fontSize=9.5,
		leading=12.0,
		textColor=pl['colors'].HexColor('#404040'),
	)

	def make_paragraph(cell, style, align=None):
		markup = _cell_to_paragraph_markup(cell)
		# Default cell wrapper uses the body font; explicit <font name=...> runs
		# inside the markup override per-run for mixed-font cells.
		if align is not None:
			style = pl['ParagraphStyle']('cell_aligned', parent=style, alignment=align)
		return pl['Paragraph'](markup if markup else '&nbsp;', style)

	align_map = {'L': 0, 'C': 1, 'R': 2, 'left': 0, 'center': 1, 'right': 2}

	# Build header row (with optional per-column alignment override).
	header_cells = []
	for c in columns:
		align = align_map.get(c.get('align', 'C'), 1)
		header_cells.append(make_paragraph(c.get('label', ''), header_style, align=align))

	# Build body rows.
	table_data = [header_cells]
	row_aligns = [align_map.get(c.get('align', 'L'), 0) for c in columns]
	for r in rows:
		if r is None:
			continue
		# Normalize row length to col_count
		cells = list(r)
		while len(cells) < col_count:
			cells.append('')
		cells = cells[:col_count]
		para_row = [
			make_paragraph(cell, body_style, align=row_aligns[i])
			for i, cell in enumerate(cells)
		]
		table_data.append(para_row)

	def rgb_to_color(rgb):
		r, g, b = _rgb(rgb)
		return pl['colors'].Color(r / 255.0, g / 255.0, b / 255.0)

	grid = rgb_to_color(grid_color)
	header_bg = rgb_to_color(header_fill)
	zebra_bg = pl['colors'].HexColor('#F6F6F6')
	white = pl['colors'].white

	style_cmds = [
		# Header row
		('BACKGROUND', (0, 0), (-1, 0), header_bg),
		('LINEBELOW', (0, 0), (-1, 0), 0.6, grid),
		('TOPPADDING', (0, 0), (-1, 0), 5),
		('BOTTOMPADDING', (0, 0), (-1, 0), 5),
		# All cells
		('GRID', (0, 0), (-1, -1), 0.3, grid),
		('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
		('LEFTPADDING', (0, 0), (-1, -1), 4),
		('RIGHTPADDING', (0, 0), (-1, -1), 4),
		('TOPPADDING', (0, 1), (-1, -1), 3),
		('BOTTOMPADDING', (0, 1), (-1, -1), 3),
	]
	if zebra and len(table_data) > 1:
		for ri in range(1, len(table_data)):
			if ri % 2 == 0:
				style_cmds.append(('BACKGROUND', (0, ri), (-1, ri), zebra_bg))
			else:
				style_cmds.append(('BACKGROUND', (0, ri), (-1, ri), white))

	table = pl['LongTable'](
		table_data,
		colWidths=col_widths,
		repeatRows=1,  # header row reprints on every page
		splitByRow=1,
	)
	table.setStyle(pl['TableStyle'](style_cmds))

	# Document & page template.
	doc = pl['BaseDocTemplate'](
		path,
		pagesize=page,
		leftMargin=margin,
		rightMargin=margin,
		topMargin=margin,
		bottomMargin=margin,
		title=title or default_title,
		author='Aries',
		subject=subject or title or default_title,
	)
	frame = pl['Frame'](
		margin,
		margin,
		printable_w,
		printable_h,
		leftPadding=0,
		rightPadding=0,
		topPadding=0,
		bottomPadding=0,
		showBoundary=0,
		id='content',
	)

	def _on_page(canv, _doc):
		# Footer: "<title> · page N"
		canv.saveState()
		canv.setFont(font_names['text'], 8)
		canv.setFillColorRGB(0.3, 0.3, 0.3)
		footer = '%s   ·   %s %d' % (title or default_title, page_word, canv.getPageNumber())
		canv.drawRightString(page[0] - margin, margin * 0.5, footer)
		canv.restoreState()

	doc.addPageTemplates([pl['PageTemplate'](id='main', frames=[frame], onPage=_on_page)])

	story = []
	if title:
		story.append(pl['Paragraph'](_escape_paragraph_text(title), title_style))
	if header_lines:
		for line in header_lines:
			if not line:
				continue
			story.append(pl['Paragraph'](_cell_to_paragraph_markup(line), subtitle_style))
	if story:
		story.append(pl['Spacer'](1, 6))
	story.append(table)

	doc.build(story)
	return True


def _render_chart_bitmap_highres(source_owner, target_w):
	"""Try to re-render a chart wheel at a higher resolution for PDF export.

	The morin main frame stores its chart-wheel bitmap in ``self.buffer`` at
	the on-screen size (often 1× for legacy compatibility). Embedding that
	directly into a PDF yields a blurry raster. If the owner exposes the
	GraphChart renderer (via ``self.gchart`` or a ``rerender_for_export``
	hook), we can request a fresh, much larger bitmap purely for export.

	Returns a (bitmap, width, height) tuple, or ``None`` if no high-res
	render path is available — caller falls back to the original bitmap.
	"""
	if source_owner is None or target_w <= 0:
		return None
	hook = getattr(source_owner, 'render_chart_bitmap_for_export', None)
	if callable(hook):
		try:
			result = hook(target_w)
			if result is not None and getattr(result, 'IsOk', lambda: False)():
				return result, int(result.GetWidth()), int(result.GetHeight())
		except Exception:
			pass
	# Fallback: re-build the chart wheel manually if the owner exposes its
	# active GraphChart and a stored size/options. Kept narrow on purpose —
	# only the morin main frame currently exposes these.
	try:
		import graphchart
		chrt = getattr(source_owner, 'horoscope', None) or getattr(source_owner, 'chart', None)
		opts = getattr(source_owner, 'options', None)
		if chrt is None or opts is None:
			return None
		bw = bool(getattr(source_owner, 'bw', False))
		target_h = target_w
		gc = graphchart.GraphChart(chrt, (target_w, target_h), opts, bw)
		# GraphChart.drawChart paints the wheel onto its internal buffer (the
		# constructor creates the buffer but does not draw yet). Some
		# subclasses or callers may use drawBkg as a synonym — try both.
		for method_name in ('drawChart', 'drawBkg'):
			method = getattr(gc, method_name, None)
			if callable(method):
				try:
					method()
				except Exception:
					continue
				break
		bmp = getattr(gc, 'buffer', None)
		if bmp is not None and getattr(bmp, 'IsOk', lambda: False)():
			return bmp, int(bmp.GetWidth()), int(bmp.GetHeight())
	except Exception:
		pass
	return None


def _overlay_font_role(wx_font):
	try:
		face = wx_font.GetFaceName()
	except Exception:
		face = ''
	return 'symbol' if 'morinus' in str(face).lower() else 'text'


def _overlay_font_size(wx_font, scale):
	try:
		size = float(wx_font.GetPointSize())
	except Exception:
		size = 10.0
	return max(4.0, size * scale)


def _overlay_source_xy(label, width, height):
	anchor = label.get('anchor')
	dx = float(label.get('dx', 0.0) or 0.0)
	dy = float(label.get('dy', 0.0) or 0.0)
	if anchor == 'top-left':
		return dx, dy
	if anchor == 'top-right':
		return float(width) - dx, dy
	if anchor == 'bottom-left':
		return dx, float(height) - dy
	if anchor == 'bottom-right':
		return float(width) - dx, float(height) - dy
	if anchor == 'wheel-center':
		return (float(width) / 2.0) + dx, (float(height) / 2.0) + dy
	return None


def _draw_bitmap_overlay_labels(doc, overlay_labels, width, height, left, top, scale):
	if not overlay_labels:
		return
	font_names = _ensure_registered_fonts()
	for label in overlay_labels:
		if not isinstance(label, dict):
			continue
		text = str(label.get('text') or '')
		if not text:
			continue
		source_xy = _overlay_source_xy(label, width, height)
		if source_xy is None:
			continue
		wx_font = label.get('wx_font')
		role = _overlay_font_role(wx_font)
		size = _overlay_font_size(wx_font, scale)
		x = float(left) + source_xy[0] * float(scale)
		top_y = float(top) - source_xy[1] * float(scale)
		doc.setFont(font_names.get(role, font_names['text']), size)
		color = _rgb(label.get('color'), default=(0, 0, 0))
		doc.setFillColorRGB(color[0] / 255.0, color[1] / 255.0, color[2] / 255.0)
		doc.drawString(x, top_y - (size * 0.82), text)


def export_bitmap_to_pdf(bitmap, path, title=None, source_owner=None, overlay_labels=None):
	"""Export a wx.Bitmap as a vector-backed PDF page.

	For the chart wheel (and any other raster-rendered view) we try to
	*re-render* the source at the printable page resolution first so the PDF
	is not just an upscaled 1× screen capture. Falls back to the supplied
	bitmap when no high-res path is available.
	"""
	if bitmap is None or not getattr(bitmap, 'IsOk', lambda: False)():
		raise PDFExportError('There is no image to export.')
	width = int(bitmap.GetWidth())
	height = int(bitmap.GetHeight())
	if width <= 0 or height <= 0:
		raise PDFExportError('There is no image to export.')

	_pagesizes, _pdfmetrics, _TTFont, canvas = _reportlab()
	page, _margin, left, top, scale = _bitmap_page_geometry(width, height)

	# Aim for 200 DPI inside the printable area when re-render is available.
	# Page width is in PDF points (1/72 inch); 200 DPI → points * 200 / 72.
	target_px = int((page[0] - 72.0) * 200.0 / 72.0)
	highres = _render_chart_bitmap_highres(source_owner, target_px) if source_owner is not None else None
	if highres is not None:
		bitmap, width, height = highres
		# Recompute geometry for the new aspect ratio.
		page, _margin, left, top, scale = _bitmap_page_geometry(width, height)

	chart_title = mtexts.txts.get('AriesChartExport', 'Aries Chart Export')
	doc = canvas.Canvas(path, pagesize=page)
	try:
		doc.setTitle(title or chart_title)
		doc.setAuthor('Aries')
		doc.setSubject(title or chart_title)
	except Exception:
		pass

	tmp_path = None
	try:
		tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
		tmp_path = tmp.name
		tmp.close()
		if not bitmap.SaveFile(tmp_path, wx.BITMAP_TYPE_PNG):
			raise PDFExportError('Could not prepare chart image for PDF export.')

		image_w = width * scale
		image_h = height * scale
		doc.saveState()
		doc.setFillColorRGB(1, 1, 1)
		doc.rect(0, 0, page[0], page[1], stroke=0, fill=1)
		doc.drawImage(
			tmp_path,
			left,
			top - image_h,
			width=image_w,
			height=image_h,
			preserveAspectRatio=True,
			mask='auto',
		)
		_draw_bitmap_overlay_labels(doc, overlay_labels, width, height, left, top, scale)
		doc.restoreState()
		doc.showPage()
		doc.save()
	finally:
		if tmp_path:
			try:
				os.remove(tmp_path)
			except Exception:
				pass
	return True


def _draw_window(wnd, draw, dc):
	custom = getattr(wnd, 'export_pdf_draw', None)
	if callable(custom):
		orig = _install_pdf_direct_fonts(wnd)
		try:
			custom(draw, dc)
		finally:
			_restore_attrs(wnd, orig)
		return

	drawdc = getattr(wnd, '_drawDC', None)
	if not callable(drawdc):
		raise PDFExportError('This view does not have a vector PDF export path yet.')
	orig = _install_pdf_dc_fonts(wnd)
	try:
		drawdc(draw, dc)
	finally:
		_restore_attrs(wnd, orig)


def export_window_to_pdf(wnd, path):
	if not is_vector_pdf_supported(wnd):
		raise PDFExportError('This view does not have a vector PDF export path yet.')

	# 1. Explicit per-window document path (e.g. the PD list — primdirslistwnd).
	document_export = getattr(wnd, 'export_pdf_document', None)
	if callable(document_export):
		return document_export(path)

	# 2. Declarative spec → Platypus table (the recommended path for any data
	#    table; windows just provide pdf_export_spec()).
	spec_provider = getattr(wnd, 'pdf_export_spec', None)
	if callable(spec_provider):
		return export_window_spec_to_pdf(wnd, path)

	_pagesizes, _pdfmetrics, _TTFont, canvas = _reportlab()
	content_width, content_height = _logical_size(wnd)
	page, margin, left, top, scale, page_logical_h = _page_geometry(content_width, content_height)
	page_count = max(1, int(math.ceil(content_height / page_logical_h)))
	doc = canvas.Canvas(path, pagesize=page)
	try:
		doc.setTitle(getattr(getattr(wnd, 'chart', None), 'name', 'Morinus Export') or 'Morinus Export')
	except Exception:
		pass

	for page_index in range(page_count):
		y_offset = page_index * page_logical_h
		draw = ReportLabDraw(doc, page[1], left, top, scale, y_offset, page_logical_h)
		dc = PDFDCStub(draw)
		doc.saveState()
		path_obj = doc.beginPath()
		path_obj.rect(margin, margin, page[0] - 2 * margin, page[1] - 2 * margin)
		doc.clipPath(path_obj, stroke=0, fill=0)
		draw.rectangle((0, y_offset, content_width, y_offset + page_logical_h), fill=_PRINT_BACKGROUND)
		_draw_window(wnd, draw, dc)
		doc.restoreState()
		doc.showPage()
	doc.save()
	return True

import wx


def _to_colour(rgb):
	return wx.Colour(*rgb)


def _sidebar_colour(options):
	return getattr(options, 'clrsidebar', options.clrbackground)


def _sidebar_text_colour(options):
	return getattr(options, 'clrsidebartext', options.clrtexts)


def _display_client_height(window):
	try:
		display_index = wx.Display.GetFromWindow(window)
		if display_index != wx.NOT_FOUND:
			return wx.Display(display_index).GetClientArea().GetHeight()
	except Exception:
		pass
	try:
		return wx.GetDisplaySize().GetHeight()
	except Exception:
		return 900


def _mix_channel(base, target, weight):
	return int(round((base * (1.0 - weight)) + (target * weight)))


def _mix_colour(rgb, target, weight):
	return wx.Colour(
		_mix_channel(rgb[0], target, weight),
		_mix_channel(rgb[1], target, weight),
		_mix_channel(rgb[2], target, weight),
	)


def _state_value(obj, name, default=None):
	if hasattr(obj, name):
		return getattr(obj, name)
	if isinstance(obj, dict):
		return obj.get(name, default)
	return default


class _ScreenPositionContextEvent(object):
	def __init__(self, screen_position):
		self._screen_position = screen_position

	def GetPosition(self):
		return self._screen_position

	def Skip(self):
		pass


_ROW_RADIUS = 8
_ROW_PAD_X = 8
_ROW_PAD_Y = 5
_NAV_LINK_SIDE_MARGIN = 8
_SCROLLBAR_HOVER_ZONE        = 14
_SCROLLBAR_THUMB_WIDTH       = 10
_SCROLLBAR_THUMB_HEIGHT      = 97
_SCROLLBAR_MARGIN            = 2
_SCROLLBAR_RADIUS            = 3
_SCROLLBAR_FADE_STEPS        = 20
_SCROLLBAR_FADE_INTERVAL_MS  = 50
_SCROLLBAR_INACTIVITY_MS     = 1000
_SECTION_TITLE_SIDE_MARGIN = 12
_SIDEBAR_MIN_WIDTH = 148
_SIDEBAR_MAX_WIDTH = 240
_SIDEBAR_STARTUP_WIDTH = 245
_SIDEBAR_SAFETY_WIDTH = 16
_SIDEBAR_LINK_FONT_PT = 13
_SIDEBAR_TITLE_FONT_PT = 10
_DOC_INDENT_PIXELS = 12
_DRAG_THRESHOLD_PX = 5
_DROP_INDICATOR_HEIGHT = 2
_CLOSE_FADE_STEPS = 4
_CLOSE_FADE_INTERVAL_MS = 30


class SoftVerticalDivider(wx.Panel):
	def __init__(self, parent, options):
		wx.Panel.__init__(self, parent, -1)
		self.options = options
		self.SetMinSize((1, -1))
		self.SetMaxSize((1, -1))
		self.SetBackgroundStyle(wx.BG_STYLE_PAINT)
		self.Bind(wx.EVT_PAINT, self._on_paint)
		self.refresh_theme()

	def _line_colour(self):
		base = _sidebar_colour(self.options)
		luma = ((base[0] * 299) + (base[1] * 587) + (base[2] * 114)) / 1000.0
		target = 0 if luma >= 140.0 else 255
		return _mix_colour(base, target, 0.13)

	def refresh_theme(self):
		self.SetBackgroundColour(self._line_colour())
		self.Refresh()

	def _on_paint(self, event):
		dc = wx.AutoBufferedPaintDC(self)
		dc.SetBackground(wx.Brush(self._line_colour()))
		dc.Clear()


class WorkspaceNavLink(wx.Panel):
	def __init__(self, parent, options, item_id, label, subtitle='', selected=False, on_action=None, on_close=None, indent_level=0, on_context=None, on_drag_begin=None):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self.item_id = item_id
		self._on_action = on_action
		self._on_close = on_close
		self._on_context = on_context
		self._on_drag_begin = on_drag_begin
		self._enabled = True
		self._selected = bool(selected)
		self._hovered = False
		self._indent_level = max(0, int(indent_level))
		self._mouse_down_pos = None
		self._dragging = False

		self.SetBackgroundStyle(wx.BG_STYLE_PAINT)

		self._label = wx.StaticText(self, -1, label, style=wx.ST_ELLIPSIZE_END)
		label_font = self._label.GetFont()
		label_font.SetPointSize(_SIDEBAR_LINK_FONT_PT)
		self._label.SetFont(label_font)
		self._label.SetMinSize((1, -1))
		self._label.SetCursor(wx.Cursor(wx.CURSOR_HAND))

		self._close = None
		if self._on_close is not None:
			self._close = wx.StaticText(self, -1, u'\u2715')  # ✕ heavy multiplication x
			close_font = self._close.GetFont()
			close_font.SetPointSize(_SIDEBAR_LINK_FONT_PT)
			self._close.SetFont(close_font)
			self._close.SetCursor(wx.Cursor(wx.CURSOR_HAND))
			self._close.Hide()

		row_sizer = wx.BoxSizer(wx.HORIZONTAL)
		if self._indent_level > 0:
			row_sizer.AddSpacer(self._indent_level * _DOC_INDENT_PIXELS)
		row_sizer.Add(self._label, 1, wx.ALIGN_CENTER_VERTICAL)
		if self._close is not None:
			close_item = row_sizer.Add(self._close, 0, wx.LEFT | wx.ALIGN_CENTER_VERTICAL | wx.RESERVE_SPACE_EVEN_IF_HIDDEN, 6)
			_ = close_item  # kept to satisfy RESERVE_SPACE_EVEN_IF_HIDDEN

		sizer = wx.BoxSizer(wx.VERTICAL)
		sizer.AddSpacer(_ROW_PAD_Y)
		sizer.Add(row_sizer, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, _ROW_PAD_X)
		sizer.AddSpacer(_ROW_PAD_Y)
		self.SetSizer(sizer)
		self.SetMinSize((-1, self._label.GetBestHeight(-1) + _ROW_PAD_Y * 2 + 2))

		for w in self._clickables():
			w.Bind(wx.EVT_LEFT_DOWN, self._on_left_down)
			w.Bind(wx.EVT_MOTION, self._on_motion)
			w.Bind(wx.EVT_LEFT_UP, self._on_left_up)
		if self._close is not None:
			self._close.Bind(wx.EVT_LEFT_UP, self._close_item)
		for w in [self] + self._all_children():
			w.Bind(wx.EVT_CONTEXT_MENU, self._on_context_menu)
			w.Bind(wx.EVT_RIGHT_UP, self._on_right_up)
		for w in [self] + self._all_children():
			w.Bind(wx.EVT_ENTER_WINDOW, self._hover_on)
			w.Bind(wx.EVT_LEAVE_WINDOW, self._hover_off)

		self._close_opacity = 0.0
		self._close_fading_in = False
		self._close_fade_timer = wx.Timer(self)
		self.Bind(wx.EVT_TIMER, self._on_close_fade_tick, self._close_fade_timer)
		self.Bind(wx.EVT_WINDOW_DESTROY, self._on_nav_destroy)

		self.Bind(wx.EVT_PAINT, self._on_paint)
		self._apply_state()

	def _clickables(self):
		result = [self, self._label]
		return result

	def _all_children(self):
		result = [self._label]
		if self._close is not None:
			result.append(self._close)
		return result

	def set_dragging(self, dragging):
		self._dragging = bool(dragging)
		self._apply_state()

	def set_enabled(self, enabled):
		self._enabled = bool(enabled)
		self._apply_state()

	def set_selected(self, selected):
		self._selected = bool(selected)
		self._apply_state()

	def refresh_theme(self, hovered):
		self._hovered = bool(hovered)
		if self._close is not None and not self._hovered:
			self._close_fade_timer.Stop()
			self._close_opacity = 0.0
			self._update_close_colour()
			self._close.Hide()
		self._apply_state()

	def _apply_state(self):
		if self._dragging:
			text_colour = _mix_colour(_sidebar_text_colour(self.options), 255, 0.55)
		elif self._enabled:
			text_colour = _mix_colour(_sidebar_text_colour(self.options), 255, 0.0)
		else:
			text_colour = _mix_colour(_sidebar_text_colour(self.options), 255, 0.55)
		self._label.SetForegroundColour(text_colour)

		self.Refresh()

	def _hover_on(self, event):
		if not self._hovered and self._enabled:
			self._hovered = True
			self._apply_state()
			if self._close is not None:
				self._close_opacity = 0.0
				self._update_close_colour()
				self._close.Show()
				self._close_fading_in = True
				self._close_fade_timer.Stop()
				self._close_fade_timer.Start(_CLOSE_FADE_INTERVAL_MS)
		event.Skip()

	def _hover_off(self, event):
		mouse = wx.GetMousePosition()
		rect = self.GetScreenRect()
		if not rect.Contains(mouse):
			self._hovered = False
			self._apply_state()
			if self._close is not None:
				self._close_fading_in = False
				self._close_fade_timer.Stop()
				self._close_fade_timer.Start(_CLOSE_FADE_INTERVAL_MS)
		event.Skip()

	def _on_close_fade_tick(self, event):
		step = 1.0 / _CLOSE_FADE_STEPS
		if self._close_fading_in:
			self._close_opacity = min(1.0, self._close_opacity + step)
		else:
			self._close_opacity = max(0.0, self._close_opacity - step)
		if self._close_opacity in (0.0, 1.0):
			self._close_fade_timer.Stop()
			if self._close_opacity == 0.0 and self._close is not None:
				self._close.Hide()
		self._update_close_colour()

	def _update_close_colour(self):
		if self._close is None:
			return
		bg = _sidebar_colour(self.options)
		text = _sidebar_text_colour(self.options)
		r = _mix_channel(bg[0], text[0], self._close_opacity * 0.70)
		g = _mix_channel(bg[1], text[1], self._close_opacity * 0.70)
		b = _mix_channel(bg[2], text[2], self._close_opacity * 0.70)
		self._close.SetForegroundColour(wx.Colour(r, g, b))
		self._close.Refresh()

	def _on_nav_destroy(self, event):
		self._close_fade_timer.Stop()
		event.Skip()

	def _on_left_down(self, event):
		if not self._enabled:
			return
		widget = event.GetEventObject()
		self._mouse_down_pos = widget.ClientToScreen(event.GetPosition())
		event.Skip()

	def _on_motion(self, event):
		if self._mouse_down_pos is None or not event.LeftIsDown():
			event.Skip()
			return
		widget = event.GetEventObject()
		pos = widget.ClientToScreen(event.GetPosition())
		dy = abs(pos.y - self._mouse_down_pos.y)
		if dy >= _DRAG_THRESHOLD_PX and self._on_drag_begin is not None:
			self._mouse_down_pos = None
			self._on_drag_begin(self.item_id, pos)
		event.Skip()

	def _on_left_up(self, event):
		if self._mouse_down_pos is not None:
			self._mouse_down_pos = None
			if self._enabled and self._on_action is not None:
				wx.CallAfter(self._on_action, self.item_id)
		event.Skip()

	def _close_item(self, event):
		if self._enabled and self._on_close is not None:
			wx.CallAfter(self._on_close, self.item_id)

	def _on_context_menu(self, event):
		if self._enabled and self._on_context is not None:
			self._on_context(self.item_id, event)

	def _on_right_up(self, event):
		if self._enabled and self._on_context is not None:
			screen_position = wx.DefaultPosition
			try:
				screen_position = self.ClientToScreen(event.GetPosition())
			except Exception:
				pass
			self._on_context(self.item_id, _ScreenPositionContextEvent(screen_position))

	def _on_paint(self, event):
		dc = wx.AutoBufferedPaintDC(self)
		bg = _to_colour(_sidebar_colour(self.options))
		dc.SetBackground(wx.Brush(bg))
		dc.Clear()

		if self._hovered and self._enabled and not self._dragging:
			fill = _mix_colour(_sidebar_colour(self.options), 0, 0.13)
		elif self._selected and self._enabled and not self._dragging:
			fill = _mix_colour(_sidebar_colour(self.options), 0, 0.09)
		else:
			fill = None

		if fill is not None:
			dc.SetBrush(wx.Brush(fill))
			dc.SetPen(wx.TRANSPARENT_PEN)
			w, h = self.GetClientSize()
			dc.DrawRoundedRectangle(2, 1, w - 4, h - 2, _ROW_RADIUS)




class WorkspaceNavigatorPane(wx.Panel):
	def __init__(self, parent, options, on_action=None, on_document=None, on_document_close=None, on_document_context=None, on_document_move=None):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self._on_action = on_action
		self._on_document = on_document
		self._on_document_close = on_document_close
		self._on_document_context = on_document_context
		self._on_document_move = on_document_move
		self._document_links = {}
		self._links = {}
		self._section_widgets = []
		self._preferred_sidebar_width = _SIDEBAR_MIN_WIDTH
		self._drag_doc_id = None
		self._drag_sibling_ids = []
		self._drag_overlay = None
		self._drag_ghost_rect = None   # (x, y, w, h) in pane-local coords
		self._drag_indicator_y = None  # pane-local y for drop indicator, or None
		self._ordered_doc_ids = []

		self._scroller = wx.ScrolledWindow(self, -1, style=wx.TAB_TRAVERSAL | wx.VSCROLL)
		self._scroller.SetScrollRate(0, 4)
		try:
			self._scroller.ShowScrollbars(wx.SHOW_SB_NEVER, wx.SHOW_SB_NEVER)
		except Exception:
			pass

		self._root = wx.Panel(self._scroller, -1, style=wx.TAB_TRAVERSAL)
		self._root_sizer = wx.BoxSizer(wx.VERTICAL)
		self._root.SetSizer(self._root_sizer)

		sizer = wx.BoxSizer(wx.VERTICAL)
		sizer.Add(self._scroller, 1, wx.EXPAND)
		self.SetSizer(sizer)

		self._custom_scrollbar = _FadingScrollbar(self, options, self._scroller)

		self.Bind(wx.EVT_SIZE, self._on_size)
		self._scroller.Bind(wx.EVT_SCROLLWIN, self._on_scroll)
		self._scroller.Bind(wx.EVT_MOUSEWHEEL, self._on_mousewheel_proxy)
		self.Bind(wx.EVT_ENTER_WINDOW, self._on_enter_sidebar)
		self._scroller.Bind(wx.EVT_ENTER_WINDOW, self._on_enter_sidebar)
		self._root.Bind(wx.EVT_ENTER_WINDOW, self._on_enter_sidebar)
		self.Bind(wx.EVT_LEAVE_WINDOW, self._on_leave_sidebar)
		self._scroller.Bind(wx.EVT_LEAVE_WINDOW, self._on_leave_sidebar)
		self._root.Bind(wx.EVT_LEAVE_WINDOW, self._on_leave_sidebar)
		self.Bind(wx.EVT_MOTION, self._on_motion_sidebar)
		self._scroller.Bind(wx.EVT_MOTION, self._on_motion_sidebar)
		self._root.Bind(wx.EVT_MOTION, self._on_motion_sidebar)

		self.refresh_theme()
		wx.CallAfter(self._reposition_scrollbar)

	def _hide_native_scrollbar(self):
		try:
			self._scroller.ShowScrollbars(wx.SHOW_SB_NEVER, wx.SHOW_SB_NEVER)
		except Exception:
			pass

	def _on_size(self, event):
		event.Skip()
		wx.CallAfter(self._reposition_scrollbar)

	def _reposition_scrollbar(self):
		try:
			w, h = self.GetClientSize()
			client_w = max(1, self._scroller.GetClientSize().x)
			content_h = max(1, self._root.GetSize().y)
			self._root.SetSize(client_w, content_h)
			self._root.Layout()
			self._scroller.SetVirtualSize(client_w, content_h)
			sb = self._custom_scrollbar
			sb.Move(w - _SCROLLBAR_HOVER_ZONE, 0)
			sb.SetSize(_SCROLLBAR_HOVER_ZONE, h)
			sb.Raise()
			sb.update_from_scroll()
		except Exception:
			pass

	def _on_scroll(self, event):
		self._custom_scrollbar.update_from_scroll()
		self._custom_scrollbar.show_bar()
		event.Skip()

	def _on_mousewheel_proxy(self, event):
		self._custom_scrollbar.show_bar()
		event.Skip()
		wx.CallAfter(self._custom_scrollbar.update_from_scroll)

	def _on_enter_sidebar(self, event):
		self._custom_scrollbar.show_bar()
		wx.CallAfter(self._custom_scrollbar.update_from_scroll)
		event.Skip()

	def _on_leave_sidebar(self, event):
		if not self.GetScreenRect().Contains(wx.GetMousePosition()):
			self._custom_scrollbar.schedule_hide()
		event.Skip()

	def _on_motion_sidebar(self, event):
		self._custom_scrollbar.show_bar()
		event.Skip()

	def _clear_sections(self):
		for widget in self._section_widgets:
			try:
				widget.Destroy()
			except Exception:
				pass
		self._section_widgets = []
		self._document_links = {}
		self._links = {}
		self._root_sizer.Clear(False)

	def _build_sections(self, documents, active_document_id, sections):
		self._clear_sections()
		self._ordered_doc_ids = []

		self._root_sizer.AddSpacer(6)

		# --- primary area: open pages ---
		for item in documents:
			doc_id = _state_value(item, 'document_id', _state_value(item, 'id'))
			indent_level = max(0, int(_state_value(item, 'indent_level', 0) or 0))
			link = WorkspaceNavLink(
				self._root,
				self.options,
				doc_id,
				_state_value(item, 'title', _state_value(item, 'label', '')),
				selected=(doc_id == active_document_id),
				on_action=self._on_document,
				on_close=self._on_document_close,
				indent_level=indent_level,
				on_context=self._on_document_context,
				on_drag_begin=self._on_drag_begin if self._on_document_move else None,
			)
			self._root_sizer.Add(link, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, _NAV_LINK_SIDE_MARGIN)
			self._root_sizer.AddSpacer(1)
			self._document_links[doc_id] = link
			self._section_widgets.append(link)
			self._ordered_doc_ids.append(doc_id)

		for section in sections:
			title = wx.StaticText(self._root, -1, _state_value(section, 'title', ''))
			title_font = title.GetFont()
			title_font.SetPointSize(_SIDEBAR_TITLE_FONT_PT)
			title_font.SetWeight(wx.FONTWEIGHT_BOLD)
			title.SetFont(title_font)
			title.SetForegroundColour(
				_mix_colour(_sidebar_text_colour(self.options), 255, 0.45)
			)
			self._root_sizer.Add(title, 0, wx.LEFT | wx.RIGHT, _SECTION_TITLE_SIDE_MARGIN)
			self._root_sizer.AddSpacer(3)
			self._section_widgets.append(title)

			for item in _state_value(section, 'items', ()):
				action_id = _state_value(item, 'action_id', _state_value(item, 'action'))
				link = WorkspaceNavLink(
					self._root,
					self.options,
					action_id,
					_state_value(item, 'label', ''),
					on_action=self._on_action,
				)
				self._root_sizer.Add(link, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, _NAV_LINK_SIDE_MARGIN)
				self._root_sizer.AddSpacer(1)
				self._links[action_id] = link
				self._section_widgets.append(link)

			self._root_sizer.AddSpacer(3)

		self._root_sizer.AddSpacer(6)
		self._root.Fit()
		client_w = max(1, self._scroller.GetClientSize().x)
		content_h = max(1, self._root.GetSize().y)
		self._root.SetSize(client_w, content_h)
		self._root.Layout()
		self._scroller.SetVirtualSize(client_w, content_h)
		self._hide_native_scrollbar()
		self._preferred_sidebar_width = self._calc_preferred_sidebar_width(documents, sections)
		self.SetMinSize((_SIDEBAR_MIN_WIDTH, -1))
		self.refresh_theme()
		wx.CallAfter(self._reposition_scrollbar)

	def _text_width(self, text, font):
		if not text:
			return 0
		try:
			dc = wx.ScreenDC()
			dc.SetFont(font)
			width, _ = dc.GetTextExtent(text)
			return width
		except Exception:
			return len(text) * 8

	def _calc_preferred_sidebar_width(self, documents, sections):
		link_font = self.GetFont()
		link_font.SetPointSize(_SIDEBAR_LINK_FONT_PT)
		title_font = self.GetFont()
		title_font.SetPointSize(_SIDEBAR_TITLE_FONT_PT)
		title_font.SetWeight(wx.FONTWEIGHT_BOLD)

		max_text_width = 0
		for document in documents:
			label = _state_value(document, 'title', _state_value(document, 'label', ''))
			indent_level = max(0, int(_state_value(document, 'indent_level', 0) or 0))
			max_text_width = max(max_text_width, self._text_width(label, link_font) + 24 + 22 + (indent_level * _DOC_INDENT_PIXELS))

		for section in sections:
			title = _state_value(section, 'title', '')
			max_text_width = max(max_text_width, self._text_width(title, title_font))
			for item in _state_value(section, 'items', ()):
				label = _state_value(item, 'label', '')
				max_text_width = max(max_text_width, self._text_width(label, link_font))

		computed = (
			max_text_width
			+ (_ROW_PAD_X * 2)
			+ (_NAV_LINK_SIDE_MARGIN * 2)
			+ _SIDEBAR_SAFETY_WIDTH
		)
		return max(_SIDEBAR_MIN_WIDTH, min(_SIDEBAR_MAX_WIDTH, computed))

	def get_preferred_sidebar_width(self):
		return self._preferred_sidebar_width

	def refresh_theme(self):
		background = _to_colour(_sidebar_colour(self.options))
		self.SetBackgroundColour(background)
		self._root.SetBackgroundColour(background)
		for widget in self._section_widgets:
			if isinstance(widget, wx.StaticText):
				widget.SetForegroundColour(_mix_colour(_sidebar_text_colour(self.options), 255, 0.45))
			elif isinstance(widget, WorkspaceNavLink):
				widget.refresh_theme(False)
		self.Refresh()
		self._root.Refresh()

	# --- drag-and-drop reordering ---

	def _on_drag_begin(self, doc_id, screen_pos):
		if self._on_document_move is None:
			return
		self._drag_doc_id = doc_id
		try:
			self._drag_sibling_ids = self._on_document_move('query_siblings', doc_id)
		except Exception:
			self._drag_sibling_ids = []
		if len(self._drag_sibling_ids) < 2:
			self._drag_doc_id = None
			return

		self._drag_overlay = wx.Overlay()

		link = self._document_links.get(doc_id)
		if link is not None:
			link.set_dragging(True)
			lw, lh = link.GetSize()
			link_local = self.ScreenToClient(link.GetScreenPosition())
			pane_w = self.GetClientSize().x
			ghost_x = link_local.x
			ghost_w = pane_w - _SCROLLBAR_HOVER_ZONE - ghost_x
			local_pos = self.ScreenToClient(screen_pos)
			ghost_y = local_pos.y - lh // 2
			self._drag_ghost_rect = (ghost_x, ghost_y, ghost_w, lh, link._label.GetLabel(), link._indent_level)
			self._drag_indicator_y = None
			self._draw_drag_overlay()

		self._scroller.SetCursor(wx.Cursor(wx.CURSOR_HAND))
		self._scroller.CaptureMouse()
		self._scroller.Bind(wx.EVT_MOTION, self._on_drag_motion)
		self._scroller.Bind(wx.EVT_LEFT_UP, self._on_drag_end)
		self._scroller.Bind(wx.EVT_MOUSE_CAPTURE_LOST, self._on_drag_lost)

	def _draw_drag_overlay(self):
		if self._drag_overlay is None:
			return
		dc = wx.ClientDC(self)
		odc = wx.DCOverlay(self._drag_overlay, dc)
		odc.Clear()

		font = self.GetFont()
		font.SetPointSize(_SIDEBAR_LINK_FONT_PT)
		pane_w = self.GetClientSize().x
		content_w = pane_w - _SCROLLBAR_HOVER_ZONE

		# draw ghost
		if self._drag_ghost_rect is not None:
			gx, gy, gw, gh, label, indent = self._drag_ghost_rect
			fill = _mix_colour(_sidebar_colour(self.options), 0, 0.13)
			dc.SetBrush(wx.Brush(fill))
			dc.SetPen(wx.TRANSPARENT_PEN)
			dc.DrawRoundedRectangle(gx + 2, gy + 1, gw - 4, gh - 2, _ROW_RADIUS)
			dc.SetFont(font)
			dc.SetTextForeground(_to_colour(_sidebar_text_colour(self.options)))
			dc.DrawText(label, gx + _ROW_PAD_X + indent * _DOC_INDENT_PIXELS, gy + _ROW_PAD_Y)

		# draw drop indicator
		if self._drag_indicator_y is not None:
			luma = sum(_sidebar_colour(self.options)) / 3.0
			accent = wx.Colour(90, 140, 220) if luma < 140 else wx.Colour(40, 90, 180)
			dc.SetBrush(wx.Brush(accent))
			dc.SetPen(wx.TRANSPARENT_PEN)
			dc.DrawRectangle(0, self._drag_indicator_y, content_w, _DROP_INDICATOR_HEIGHT)

		del odc

	def _find_drop_target(self, screen_y):
		"""Return the doc_id to insert before, or None for end of siblings."""
		for sib_id in self._drag_sibling_ids:
			if sib_id == self._drag_doc_id:
				continue
			link = self._document_links.get(sib_id)
			if link is None:
				continue
			rect = link.GetScreenRect()
			mid_y = rect.y + rect.height // 2
			if screen_y < mid_y:
				return sib_id
		return None

	def _position_drop_indicator(self, before_id):
		if before_id is not None:
			link = self._document_links.get(before_id)
			if link is not None:
				link_local = self.ScreenToClient(link.GetScreenPosition())
				self._drag_indicator_y = link_local.y - _DROP_INDICATOR_HEIGHT // 2
				return
		last_id = self._drag_sibling_ids[-1]
		link = self._document_links.get(last_id)
		if link is not None:
			link_local = self.ScreenToClient(link.GetScreenPosition())
			self._drag_indicator_y = link_local.y + link.GetSize().y + _DROP_INDICATOR_HEIGHT // 2
			return
		self._drag_indicator_y = None

	def _on_drag_motion(self, event):
		if self._drag_doc_id is None:
			event.Skip()
			return
		screen_pos = self._scroller.ClientToScreen(event.GetPosition())
		before_id = self._find_drop_target(screen_pos.y)
		self._position_drop_indicator(before_id)
		self._drag_before_id = before_id

		# update ghost position
		if self._drag_ghost_rect is not None:
			gx, gy, gw, gh, label, indent = self._drag_ghost_rect
			local_pos = self.ScreenToClient(screen_pos)
			pane_h = self.GetClientSize().y
			new_gy = max(0, min(local_pos.y - gh // 2, pane_h - gh))
			self._drag_ghost_rect = (gx, new_gy, gw, gh, label, indent)

		self._draw_drag_overlay()

	def _cleanup_drag_visuals(self):
		if self._drag_overlay is not None:
			dc = wx.ClientDC(self)
			odc = wx.DCOverlay(self._drag_overlay, dc)
			odc.Clear()
			del odc
			self._drag_overlay.Reset()
			self._drag_overlay = None
		self._drag_ghost_rect = None
		self._drag_indicator_y = None
		# restore source link
		if self._drag_doc_id is not None:
			link = self._document_links.get(self._drag_doc_id)
			if link is not None:
				link.set_dragging(False)
		self._scroller.SetCursor(wx.NullCursor)

	def _on_drag_end(self, event):
		if self._scroller.HasCapture():
			self._scroller.ReleaseMouse()
		self._scroller.Unbind(wx.EVT_MOTION)
		self._scroller.Unbind(wx.EVT_LEFT_UP)
		self._scroller.Unbind(wx.EVT_MOUSE_CAPTURE_LOST)
		self._cleanup_drag_visuals()

		doc_id = self._drag_doc_id
		before_id = getattr(self, '_drag_before_id', None)
		self._drag_doc_id = None
		self._drag_sibling_ids = []
		self._drag_before_id = None

		if doc_id and self._on_document_move:
			wx.CallAfter(self._on_document_move, 'move', doc_id, before_id)

	def _on_drag_lost(self, event):
		self._scroller.Unbind(wx.EVT_MOTION)
		self._scroller.Unbind(wx.EVT_LEFT_UP)
		self._scroller.Unbind(wx.EVT_MOUSE_CAPTURE_LOST)
		self._cleanup_drag_visuals()
		self._drag_doc_id = None
		self._drag_sibling_ids = []

	def set_navigation_state(self, state):
		documents = _state_value(state, 'documents', [])
		active_document_id = _state_value(state, 'active_document_id')
		sections = _state_value(state, 'sections', [])
		self._build_sections(documents, active_document_id, sections)
		enabled_actions = _state_value(state, 'enabled_actions', {})
		for action_id, link in self._links.items():
			link.set_enabled(bool(enabled_actions.get(action_id, False)))
		for document_id, link in self._document_links.items():
			link.set_selected(document_id == active_document_id)

	def set_active_action(self, action_id):
		for aid, link in self._links.items():
			link.set_selected(aid == action_id)


# --- VS Code-style overlay scrollbar implementation ---
class _FadingScrollbar(wx.Panel):
	def __init__(self, parent, options, scroller, bg_getter=None, thumb_max_h=None,
	             orientation=wx.VERTICAL):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL | wx.TRANSPARENT_WINDOW)
		self.options = options
		self._scroller = scroller
		self._bg_getter = bg_getter or (lambda: _sidebar_colour(self.options))
		self._thumb_max_h = thumb_max_h if thumb_max_h is not None else _SCROLLBAR_THUMB_HEIGHT
		self._orientation = orientation
		self._opacity = 0.0
		self._thumb_pos = 0
		self._thumb_size = 0
		self._dragging = False
		self._drag_start = 0
		self._drag_start_scroll_px = 0
		self._fade_timer = wx.Timer(self)
		self._inactivity_timer = wx.Timer(self)
		self.Bind(wx.EVT_TIMER, self._on_fade_tick, self._fade_timer)
		self.Bind(wx.EVT_TIMER, self._on_inactivity_tick, self._inactivity_timer)
		self.SetBackgroundStyle(wx.BG_STYLE_TRANSPARENT)
		self.Bind(wx.EVT_ERASE_BACKGROUND, lambda e: None)
		self.Bind(wx.EVT_PAINT, self._on_paint)
		self.Bind(wx.EVT_ENTER_WINDOW, self._on_enter)
		self.Bind(wx.EVT_LEAVE_WINDOW, self._on_leave)
		self.Bind(wx.EVT_LEFT_DOWN, self._on_left_down)
		self.Bind(wx.EVT_MOTION, self._on_motion)
		self.Bind(wx.EVT_LEFT_UP, self._on_left_up)
		self.Bind(wx.EVT_MOUSE_CAPTURE_LOST, self._on_capture_lost)
		self.Bind(wx.EVT_WINDOW_DESTROY, self._on_scrollbar_destroy)

	def _on_scrollbar_destroy(self, event):
		self._fade_timer.Stop()
		self._inactivity_timer.Stop()
		event.Skip()

	def _sidebar_bg(self):
		return self._bg_getter()

	def _luma(self):
		bg = self._sidebar_bg()
		return (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000.0

	def _thumb_colour(self):
		bg = self._sidebar_bg()
		if self._luma() >= 140:
			return _mix_colour(bg, 0, 0.35 * self._opacity)
		return _mix_colour(bg, 255, 0.30 * self._opacity)

	def show_bar(self):
		self._opacity = 1.0
		self._fade_timer.Stop()
		self._inactivity_timer.Stop()
		self._inactivity_timer.Start(_SCROLLBAR_INACTIVITY_MS, wx.TIMER_ONE_SHOT)
		self.Refresh()

	def schedule_hide(self):
		self._inactivity_timer.Stop()
		if not self._fade_timer.IsRunning():
			self._fade_timer.Start(_SCROLLBAR_FADE_INTERVAL_MS)

	def _on_inactivity_tick(self, event):
		self.schedule_hide()

	def _on_fade_tick(self, event):
		self._opacity -= 1.0 / _SCROLLBAR_FADE_STEPS
		if self._opacity <= 0.0:
			self._opacity = 0.0
			self._fade_timer.Stop()
		self.Refresh()

	def update_from_scroll(self):
		if self._orientation == wx.VERTICAL:
			virtual_size = self._scroller.GetVirtualSize().y
			client_size = self._scroller.GetClientSize().y
		else:
			virtual_size = self._scroller.GetVirtualSize().x
			client_size = self._scroller.GetClientSize().x
		if virtual_size <= client_size or virtual_size <= 0:
			self._thumb_size = 0
			self.Refresh()
			return
		if self._orientation == wx.VERTICAL:
			_, scroll_pos = self._scroller.GetViewStart()
			_, unit = self._scroller.GetScrollPixelsPerUnit()
		else:
			scroll_pos, _ = self._scroller.GetViewStart()
			unit, _ = self._scroller.GetScrollPixelsPerUnit()
		if unit <= 0:
			unit = 1
		scroll_px = scroll_pos * unit
		if self._orientation == wx.VERTICAL:
			bar_size = self.GetClientSize().y
		else:
			bar_size = self.GetClientSize().x
		thumb_size = min(self._thumb_max_h, bar_size)
		scrollable_px = virtual_size - client_size
		scrollable_bar = max(1, bar_size - thumb_size)
		if scrollable_px > 0:
			thumb_pos = int(scroll_px / float(scrollable_px) * scrollable_bar)
		else:
			thumb_pos = 0
		self._thumb_pos = max(0, min(thumb_pos, bar_size - thumb_size))
		self._thumb_size = thumb_size
		self.Refresh()

	def _thumb_rect_coords(self):
		edge = _SCROLLBAR_HOVER_ZONE - _SCROLLBAR_THUMB_WIDTH - _SCROLLBAR_MARGIN
		if self._orientation == wx.VERTICAL:
			return edge, self._thumb_pos, _SCROLLBAR_THUMB_WIDTH, self._thumb_size
		else:
			return self._thumb_pos, edge, self._thumb_size, _SCROLLBAR_THUMB_WIDTH

	def _on_paint(self, event):
		dc = wx.PaintDC(self)
		if self._opacity <= 0.01 or self._thumb_size <= 0:
			return
		tx, ty, tw, th = self._thumb_rect_coords()
		dc.SetBrush(wx.Brush(self._thumb_colour()))
		dc.SetPen(wx.TRANSPARENT_PEN)
		dc.DrawRoundedRectangle(tx, ty, tw, th, _SCROLLBAR_RADIUS)

	def _on_enter(self, event):
		self.show_bar()
		event.Skip()

	def _on_leave(self, event):
		if self._dragging:
			event.Skip()
			return
		if not self.GetScreenRect().Contains(wx.GetMousePosition()):
			self.schedule_hide()
		event.Skip()

	def _on_left_down(self, event):
		tx, ty, tw, th = self._thumb_rect_coords()
		x, y = event.GetPosition()
		if tx <= x < tx + tw and ty <= y < ty + th:
			self._dragging = True
			if self._orientation == wx.VERTICAL:
				self._drag_start = y
				_, scroll_pos = self._scroller.GetViewStart()
				_, unit = self._scroller.GetScrollPixelsPerUnit()
			else:
				self._drag_start = x
				scroll_pos, _ = self._scroller.GetViewStart()
				unit, _ = self._scroller.GetScrollPixelsPerUnit()
			if unit <= 0:
				unit = 1
			self._drag_start_scroll_px = scroll_pos * unit
			self.CaptureMouse()
		event.Skip()

	def _on_motion(self, event):
		if not self._dragging:
			event.Skip()
			return
		if self._orientation == wx.VERTICAL:
			delta = event.GetPosition().y - self._drag_start
			virtual_size = self._scroller.GetVirtualSize().y
			client_size = self._scroller.GetClientSize().y
			bar_size = self.GetClientSize().y
			_, unit = self._scroller.GetScrollPixelsPerUnit()
		else:
			delta = event.GetPosition().x - self._drag_start
			virtual_size = self._scroller.GetVirtualSize().x
			client_size = self._scroller.GetClientSize().x
			bar_size = self.GetClientSize().x
			unit, _ = self._scroller.GetScrollPixelsPerUnit()
		thumb_size = self._thumb_size if self._thumb_size > 0 else self._thumb_max_h
		scrollable_bar = max(1, bar_size - thumb_size)
		scrollable_px = max(1, virtual_size - client_size)
		new_px = self._drag_start_scroll_px + int(delta / float(scrollable_bar) * scrollable_px)
		if unit <= 0:
			unit = 1
		if self._orientation == wx.VERTICAL:
			self._scroller.Scroll(-1, max(0, new_px // unit))
		else:
			self._scroller.Scroll(max(0, new_px // unit), -1)
		self.update_from_scroll()
		event.Skip()

	def _on_left_up(self, event):
		if self._dragging:
			self._dragging = False
			if self.HasCapture():
				self.ReleaseMouse()
			self.update_from_scroll()
		event.Skip()

	def _on_capture_lost(self, event):
		self._dragging = False


class CentralChartHost(wx.Panel):
	def __init__(self, parent, options, context_menu_handler=None, resize_handler=None):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self._context_menu_handler = context_menu_handler
		self._resize_handler = resize_handler
		self._buffer = wx.Bitmap(1, 1)
		self._splash = None  # dict with photo, title, subtitle, info lines

		try:
			self.SetDoubleBuffered(True)
		except Exception:
			pass
		self.SetBackgroundStyle(wx.BG_STYLE_PAINT)
		self.SetBackgroundColour(_to_colour(self.options.clrbackground))

		self.Bind(wx.EVT_PAINT, self.on_paint)
		self.Bind(wx.EVT_ERASE_BACKGROUND, self.on_erase_background)
		self.Bind(wx.EVT_SIZE, self.on_size)
		self.Bind(wx.EVT_CONTEXT_MENU, self.on_context_menu)
		self.Bind(wx.EVT_RIGHT_UP, self.on_right_up)

	def set_splash(self, photo, title, subtitle, info_lines):
		"""Show a splash screen with a photo and native text."""
		self._splash = dict(photo=photo, title=title, subtitle=subtitle,
		                    info=info_lines)
		self.Refresh()

	def set_bitmap(self, bitmap, center=False, background_colour=None):
		if bitmap is None:
			bitmap = wx.Bitmap(1, 1)

		self._splash = None
		self._buffer = bitmap
		if background_colour is not None:
			self.SetBackgroundColour(background_colour)
		else:
			self.SetBackgroundColour(_to_colour(self.options.clrbackground))
		self.Refresh()

	def refresh_theme(self):
		self.SetBackgroundColour(_to_colour(self.options.clrbackground))
		self.Refresh()

	def get_chart_size(self):
		size = self.GetClientSize()
		available_width = max(1, int(getattr(size, 'x', 1)) - 24)
		available_height = max(1, int(getattr(size, 'y', 1)) - 24)
		max_side = max(1, int(_display_client_height(self) * 0.80))
		side = min(max_side, available_width, available_height)
		return wx.Size(side, side)

	def refresh_host(self):
		self.Refresh()

	def on_paint(self, event):
		dc = wx.AutoBufferedPaintDC(self)
		dc.SetBackground(wx.Brush(self.GetBackgroundColour()))
		dc.Clear()

		if self._splash is not None:
			self._paint_splash(dc)
			return

		if self._buffer is None:
			return

		size = self.GetClientSize()
		x = max(0, int((size.x - self._buffer.GetWidth()) // 2))
		y = max(0, int((size.y - self._buffer.GetHeight()) // 2))
		dc.DrawBitmap(self._buffer, x, y)

	def _paint_splash(self, dc):
		import math
		sp = self._splash
		photo = sp['photo']
		pw, ph = photo.GetWidth(), photo.GetHeight()
		size = self.GetClientSize()

		bg = self.GetBackgroundColour()
		lum = .299 * bg.Red() + .587 * bg.Green() + .114 * bg.Blue()
		fg = wx.Colour(30, 30, 30) if lum > 128 else wx.Colour(225, 225, 225)

		gc = wx.GraphicsContext.Create(dc)

		# Fonts scaled to photo width
		face = 'FreeSans'
		fnt_title = wx.Font(max(14, pw // 9), wx.FONTFAMILY_DEFAULT,
		                    wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL, False, face)
		fnt_sub = wx.Font(max(8, pw // 18), wx.FONTFAMILY_DEFAULT,
		                  wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL, False, face)
		fnt_xs = wx.Font(max(6, pw // 24), wx.FONTFAMILY_DEFAULT,
		                 wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL, False, face)

		# Measure text heights for vertical layout
		gc.SetFont(fnt_title, fg)
		aw, ah = gc.GetTextExtent('A')
		rw, _ = gc.GetTextExtent('RIES')
		gc.SetFont(fnt_sub, fg)
		_, sh = gc.GetTextExtent(sp['subtitle'])
		gc.SetFont(fnt_xs, fg)
		_, xh = gc.GetTextExtent('X')

		gap = max(10, ph // 35)
		shear = math.tan(math.radians(19))
		kern = shear * ah / 3 + 1
		lh = int(xh * 1.5)
		n_info = len(sp['info'])
		total_h = ph + gap + int(ah) + gap // 2 + int(sh) + gap + lh * n_info

		# Vertical start: center the whole block
		y0 = max(0, (size.y - total_h) // 2)
		cx = size.x // 2

		# Photo
		dc.DrawBitmap(photo, max(0, cx - pw // 2), y0)
		y = y0 + ph + gap

		# "ARIES" with 19° false-italic A via GraphicsContext shear
		gc.SetFont(fnt_title, fg)
		title_w = aw + kern + rw
		tx = cx - title_w / 2

		gc.PushState()
		gc.Translate(tx, y)
		gc.ConcatTransform(gc.CreateMatrix(1, 0, -shear, 1, shear * ah, 0))
		gc.DrawText(sp['title'][0], 0, 0)  # "A"
		gc.PopState()
		gc.DrawText(sp['title'][1:], tx + aw + kern, y)  # "RIES"
		y += int(ah) + gap // 2

		# Subtitle
		gc.SetFont(fnt_sub, fg)
		sw, _ = gc.GetTextExtent(sp['subtitle'])
		gc.DrawText(sp['subtitle'], cx - sw / 2, y)
		y += int(sh) + gap

		# Info lines
		gc.SetFont(fnt_xs, fg)
		for line in sp['info']:
			line = line.strip()
			lw, _ = gc.GetTextExtent(line)
			gc.DrawText(line, cx - lw / 2, y)
			y += lh

	def on_erase_background(self, event):
		return

	def on_size(self, event):
		if self._resize_handler is not None:
			try:
				self._resize_handler()
			except Exception:
				pass
		event.Skip()

	def on_context_menu(self, event):
		if self._context_menu_handler is not None:
			self._context_menu_handler(event)

	def on_right_up(self, event):
		if self._context_menu_handler is None:
			return
		screen_position = wx.DefaultPosition
		try:
			screen_position = self.ClientToScreen(event.GetPosition())
		except Exception:
			pass
		self._context_menu_handler(_ScreenPositionContextEvent(screen_position))


class MainWindowShell(wx.Panel):
	def __init__(
		self,
		parent,
		options,
		chart_context_menu_handler=None,
		chart_resize_handler=None,
		navigator_state_provider=None,
		navigator_action_handler=None,
		navigator_document_handler=None,
		navigator_document_close_handler=None,
		navigator_document_context_handler=None,
		navigator_open_path_handler=None,
		navigator_document_move_handler=None,
	):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self.SetName('workspace_shell')
		self._navigator_state_provider = navigator_state_provider
		self._startup_sash_applied = False

		self._splitter = wx.SplitterWindow(
			self,
			-1,
			style=wx.SP_LIVE_UPDATE | wx.SP_THIN_SASH,
		)

		self.navigator_pane = WorkspaceNavigatorPane(
			self._splitter,
			options,
			on_action=navigator_action_handler,
			on_document=navigator_document_handler,
			on_document_close=navigator_document_close_handler,
			on_document_context=navigator_document_context_handler,
			on_document_move=navigator_document_move_handler,
		)

		self._content_panel = wx.Panel(self._splitter, -1)
		self._content_panel.SetBackgroundColour(_to_colour(self.options.clrbackground))
		self._content_area = wx.Panel(self._content_panel, -1)
		self._content_area.SetBackgroundColour(_to_colour(self.options.clrbackground))

		self.chart_host = CentralChartHost(
			self._content_area,
			options,
			context_menu_handler=chart_context_menu_handler,
			resize_handler=chart_resize_handler,
		)

		self._table_host = wx.Panel(self._content_area, -1)
		self._table_host.Hide()

		self._vertical_divider = SoftVerticalDivider(self._content_panel, self.options)

		content_sizer = wx.BoxSizer(wx.VERTICAL)
		content_sizer.Add(self.chart_host, 1, wx.EXPAND)
		content_sizer.Add(self._table_host, 1, wx.EXPAND)
		self._content_area.SetSizer(content_sizer)

		content_panel_sizer = wx.BoxSizer(wx.HORIZONTAL)
		content_panel_sizer.Add(self._vertical_divider, 0, wx.EXPAND)
		content_panel_sizer.Add(self._content_area, 1, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP | wx.BOTTOM, 6)
		self._content_panel.SetSizer(content_panel_sizer)

		self._splitter.SetMinimumPaneSize(_SIDEBAR_MIN_WIDTH)
		self._splitter.SetSashGravity(0.0)
		self._splitter.SplitVertically(self.navigator_pane, self._content_panel, max(_SIDEBAR_MIN_WIDTH, _SIDEBAR_STARTUP_WIDTH))
		self._startup_sash_applied = True

		root_sizer = wx.BoxSizer(wx.VERTICAL)
		root_sizer.Add(self._splitter, 1, wx.EXPAND)
		self.SetSizer(root_sizer)

		self._table_scrollbar = None
		self._table_scrollbar_h = None

		self.refresh_theme()
		wx.CallAfter(self.refresh_navigation)

	def refresh_theme(self):
		background = _to_colour(self.options.clrbackground)
		self.SetBackgroundColour(background)
		self._vertical_divider.refresh_theme()
		sash_colour = self._vertical_divider._line_colour()
		self._splitter.SetBackgroundColour(sash_colour)
		self._content_panel.SetBackgroundColour(background)
		self._content_area.SetBackgroundColour(background)
		self._table_host.SetBackgroundColour(background)
		self.navigator_pane.refresh_theme()
		self.chart_host.refresh_theme()

	def set_chart_splash(self, photo, title, subtitle, info_lines):
		self.chart_host.set_splash(photo, title, subtitle, info_lines)

	def set_chart_bitmap(self, bitmap, center=False, background_colour=None):
		if background_colour is not None:
			self.SetBackgroundColour(background_colour)
		else:
			self.SetBackgroundColour(_to_colour(self.options.clrbackground))
		self.chart_host.set_bitmap(bitmap, center=center, background_colour=background_colour)

	def refresh_navigation(self):
		if self._navigator_state_provider is None:
			return
		try:
			state = self._navigator_state_provider()
		except Exception:
			return
		self.navigator_pane.set_navigation_state(state)
		if not self._startup_sash_applied and self._splitter.IsSplit():
			self._splitter.SetSashPosition(max(_SIDEBAR_MIN_WIDTH, _SIDEBAR_STARTUP_WIDTH), True)
			self._startup_sash_applied = True

	def _apply_preferred_sidebar_width(self):
		if not self._splitter.IsSplit():
			return
		preferred_width = self.navigator_pane.get_preferred_sidebar_width()
		self._splitter.SetSashPosition(preferred_width, True)

	def get_chart_host_size(self):
		return self.chart_host.get_chart_size()

	def get_preferred_sidebar_width(self):
		return self.navigator_pane.get_preferred_sidebar_width()

	def refresh_chart(self):
		self.chart_host.refresh_host()

	def get_table_host(self):
		return self._table_host

	def set_table_content(self, wnd):
		for attr in ('_table_scrollbar', '_table_scrollbar_h'):
			bar = getattr(self, attr, None)
			if bar is not None:
				try:
					bar.Destroy()
				except Exception:
					pass
				setattr(self, attr, None)
		for child in list(self._table_host.GetChildren()):
			if child is wnd:
				continue
			try:
				child.Destroy()
			except Exception:
				pass
		sizer = wx.BoxSizer(wx.VERTICAL)
		sizer.Add(wnd, 1, wx.EXPAND)
		self._table_host.SetSizer(sizer)
		self._table_host.Layout()
		self.chart_host.Hide()
		self._table_host.Show()
		self._content_panel.Layout()
		self.Layout()

		try:
			wnd.ShowScrollbars(wx.SHOW_SB_NEVER, wx.SHOW_SB_NEVER)
		except Exception:
			pass

		_bg = lambda: self.options.clrbackground
		sb = _FadingScrollbar(
			self._table_host, self.options, wnd,
			bg_getter=_bg, thumb_max_h=60, orientation=wx.VERTICAL,
		)
		sb_h = _FadingScrollbar(
			self._table_host, self.options, wnd,
			bg_getter=_bg, thumb_max_h=60, orientation=wx.HORIZONTAL,
		)
		self._table_scrollbar = sb
		self._table_scrollbar_h = sb_h

		def _table_reposition_sb():
			try:
				w, h = self._table_host.GetClientSize()
				sb.Move(w - _SCROLLBAR_HOVER_ZONE, 0)
				sb.SetSize(_SCROLLBAR_HOVER_ZONE, h)
				sb.Raise()
				sb.update_from_scroll()
				sb_h.Move(0, h - _SCROLLBAR_HOVER_ZONE)
				sb_h.SetSize(w - _SCROLLBAR_HOVER_ZONE, _SCROLLBAR_HOVER_ZONE)
				sb_h.Raise()
				sb_h.update_from_scroll()
			except Exception:
				pass

		_table_reposition_sb()

		def _on_table_scroll(event):
			sb.update_from_scroll()
			sb.show_bar()
			sb_h.update_from_scroll()
			sb_h.show_bar()
			event.Skip()

		def _on_table_wheel(event):
			sb.show_bar()
			sb_h.show_bar()
			event.Skip()
			wx.CallAfter(sb.update_from_scroll)
			wx.CallAfter(sb_h.update_from_scroll)

		def _on_table_enter(event):
			sb.show_bar()
			sb_h.show_bar()
			wx.CallAfter(sb.update_from_scroll)
			wx.CallAfter(sb_h.update_from_scroll)
			event.Skip()

		def _on_table_leave(event):
			if not self._table_host.GetScreenRect().Contains(wx.GetMousePosition()):
				sb.schedule_hide()
				sb_h.schedule_hide()
			event.Skip()

		def _on_table_motion(event):
			sb.show_bar()
			sb_h.show_bar()
			event.Skip()

		def _on_table_host_size(event):
			event.Skip()
			wx.CallAfter(_table_reposition_sb)

		wnd.Bind(wx.EVT_SCROLLWIN, _on_table_scroll)
		wnd.Bind(wx.EVT_MOUSEWHEEL, _on_table_wheel)
		wnd.Bind(wx.EVT_ENTER_WINDOW, _on_table_enter)
		wnd.Bind(wx.EVT_LEAVE_WINDOW, _on_table_leave)
		wnd.Bind(wx.EVT_MOTION, _on_table_motion)
		wnd.Bind(wx.EVT_SIZE, _on_table_host_size)
		self._table_host.Bind(wx.EVT_SIZE, _on_table_host_size)

	def clear_table_content(self):
		if not self._table_host.IsShown():
			return
		for attr in ('_table_scrollbar', '_table_scrollbar_h'):
			bar = getattr(self, attr, None)
			if bar is not None:
				try:
					bar.Destroy()
				except Exception:
					pass
				setattr(self, attr, None)
		self._table_host.Hide()
		self.chart_host.Show()
		for child in list(self._table_host.GetChildren()):
			try:
				child.Destroy()
			except Exception:
				pass
		self._content_panel.Layout()
		self.Layout()

import wx


def _to_colour(rgb):
	return wx.Colour(*rgb)


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
_ROW_PAD_H = 10
_ROW_PAD_V = 7


class WorkspaceNavLink(wx.Panel):
	def __init__(self, parent, options, item_id, label, subtitle='', selected=False, on_action=None, on_close=None):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self.item_id = item_id
		self._on_action = on_action
		self._on_close = on_close
		self._enabled = True
		self._selected = bool(selected)
		self._hovered = False

		self.SetBackgroundStyle(wx.BG_STYLE_PAINT)

		self._label = wx.StaticText(self, -1, label)
		self._label.SetCursor(wx.Cursor(wx.CURSOR_HAND))

		self._close = None
		if self._on_close is not None:
			self._close = wx.StaticText(self, -1, u'\u00D7')
			self._close.SetCursor(wx.Cursor(wx.CURSOR_HAND))

		row_sizer = wx.BoxSizer(wx.HORIZONTAL)
		row_sizer.Add(self._label, 1, wx.ALIGN_CENTER_VERTICAL)
		if self._close is not None:
			row_sizer.Add(self._close, 0, wx.LEFT | wx.ALIGN_CENTER_VERTICAL, 6)

		sizer = wx.BoxSizer(wx.VERTICAL)
		sizer.Add(row_sizer, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP | wx.BOTTOM, _ROW_PAD_H)
		self.SetSizer(sizer)
		self.SetMinSize((-1, self._label.GetBestHeight(-1) + _ROW_PAD_H * 2 + 2))

		for w in self._clickables():
			w.Bind(wx.EVT_LEFT_UP, self._activate)
		if self._close is not None:
			self._close.Bind(wx.EVT_LEFT_UP, self._close_item)
		for w in [self] + self._all_children():
			w.Bind(wx.EVT_ENTER_WINDOW, self._hover_on)
			w.Bind(wx.EVT_LEAVE_WINDOW, self._hover_off)

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

	def set_enabled(self, enabled):
		self._enabled = bool(enabled)
		self._apply_state()

	def set_selected(self, selected):
		self._selected = bool(selected)
		self._apply_state()

	def refresh_theme(self, hovered):
		self._hovered = bool(hovered)
		self._apply_state()

	def _apply_state(self):
		if self._enabled:
			text_colour = _mix_colour(self.options.clrtexts, 255, 0.0)
		else:
			text_colour = _mix_colour(self.options.clrtexts, 255, 0.55)
		self._label.SetForegroundColour(text_colour)

		if self._close is not None:
			show_close = self._hovered or self._selected
			self._close.Show(show_close)
			if show_close:
				close_colour = _mix_colour(self.options.clrtexts, 255, 0.30)
				self._close.SetForegroundColour(close_colour)
			self.Layout()

		self.Refresh()

	def _hover_on(self, event):
		if not self._hovered and self._enabled:
			self._hovered = True
			self._apply_state()
		event.Skip()

	def _hover_off(self, event):
		mouse = wx.GetMousePosition()
		rect = self.GetScreenRect()
		if not rect.Contains(mouse):
			self._hovered = False
			self._apply_state()
		event.Skip()

	def _activate(self, event):
		if self._enabled and self._on_action is not None:
			wx.CallAfter(self._on_action, self.item_id)

	def _close_item(self, event):
		if self._enabled and self._on_close is not None:
			wx.CallAfter(self._on_close, self.item_id)

	def _on_paint(self, event):
		dc = wx.AutoBufferedPaintDC(self)
		bg = _to_colour(self.options.clrbackground)
		dc.SetBackground(wx.Brush(bg))
		dc.Clear()

		if self._selected:
			fill = _mix_colour(self.options.clrbackground, 255, 0.10)
		elif self._hovered and self._enabled:
			fill = _mix_colour(self.options.clrbackground, 255, 0.06)
		else:
			fill = None

		if fill is not None:
			dc.SetBrush(wx.Brush(fill))
			dc.SetPen(wx.TRANSPARENT_PEN)
			w, h = self.GetClientSize()
			dc.DrawRoundedRectangle(2, 1, w - 4, h - 2, _ROW_RADIUS)


class WorkspaceNavigatorPane(wx.ScrolledWindow):
	def __init__(self, parent, options, on_action=None, on_document=None, on_document_close=None):
		wx.ScrolledWindow.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL | wx.VSCROLL)

		self.options = options
		self._on_action = on_action
		self._on_document = on_document
		self._on_document_close = on_document_close
		self._document_links = {}
		self._links = {}
		self._section_widgets = []

		self.SetScrollRate(0, 16)
		self.SetMinSize((280, -1))

		self._root = wx.Panel(self, -1, style=wx.TAB_TRAVERSAL)
		self._root_sizer = wx.BoxSizer(wx.VERTICAL)
		self._root.SetSizer(self._root_sizer)

		host_sizer = wx.BoxSizer(wx.VERTICAL)
		host_sizer.Add(self._root, 1, wx.EXPAND)
		self.SetSizer(host_sizer)

		self.refresh_theme()

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

		self._root_sizer.AddSpacer(8)

		# --- primary area: open pages ---
		for item in documents:
			doc_id = _state_value(item, 'document_id', _state_value(item, 'id'))
			link = WorkspaceNavLink(
				self._root,
				self.options,
				doc_id,
				_state_value(item, 'title', _state_value(item, 'label', '')),
				selected=(doc_id == active_document_id),
				on_action=self._on_document,
				on_close=self._on_document_close,
			)
			self._root_sizer.Add(link, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)
			self._root_sizer.AddSpacer(1)
			self._document_links[doc_id] = link
			self._section_widgets.append(link)

		# --- divider between documents and launcher, only when both exist ---
		if documents and sections:
			self._root_sizer.AddSpacer(6)
			line = wx.StaticLine(self._root, -1)
			self._root_sizer.Add(line, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 16)
			self._root_sizer.AddSpacer(6)
			self._section_widgets.append(line)

		for section in sections:
			title = wx.StaticText(self._root, -1, _state_value(section, 'title', ''))
			title_font = title.GetFont()
			title_font.SetPointSize(max(9, title_font.GetPointSize() - 1))
			title_font.SetWeight(wx.FONTWEIGHT_BOLD)
			title.SetFont(title_font)
			title.SetForegroundColour(
				_mix_colour(self.options.clrtexts, 255, 0.45)
			)
			self._root_sizer.Add(title, 0, wx.LEFT | wx.RIGHT, 16)
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
				self._root_sizer.Add(link, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)
				self._root_sizer.AddSpacer(1)
				self._links[action_id] = link
				self._section_widgets.append(link)

			self._root_sizer.AddSpacer(4)

		self._root_sizer.AddStretchSpacer()
		self._root_sizer.AddSpacer(8)
		self._root.Layout()
		self.Layout()
		self.FitInside()
		self.refresh_theme()

	def refresh_theme(self):
		background = _to_colour(self.options.clrbackground)
		self.SetBackgroundColour(background)
		self._root.SetBackgroundColour(background)
		for widget in self._section_widgets:
			if isinstance(widget, wx.StaticText):
				widget.SetForegroundColour(_to_colour(self.options.clrtexts))
			elif isinstance(widget, WorkspaceNavLink):
				widget.refresh_theme(False)
		self.Refresh()
		self._root.Refresh()

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


class CentralChartHost(wx.Panel):
	def __init__(self, parent, options, context_menu_handler=None, resize_handler=None):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self._context_menu_handler = context_menu_handler
		self._resize_handler = resize_handler
		self._buffer = wx.Bitmap(1, 1)

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

	def set_bitmap(self, bitmap, center=False, background_colour=None):
		if bitmap is None:
			bitmap = wx.Bitmap(1, 1)

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

		if self._buffer is None:
			return

		size = self.GetClientSize()
		x = max(0, int((size.x - self._buffer.GetWidth()) // 2))
		y = max(0, int((size.y - self._buffer.GetHeight()) // 2))
		dc.DrawBitmap(self._buffer, x, y)

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
		navigator_open_path_handler=None,
	):
		wx.Panel.__init__(self, parent, -1, style=wx.TAB_TRAVERSAL)

		self.options = options
		self.SetName('workspace_shell')
		self._navigator_state_provider = navigator_state_provider

		self.navigator_pane = WorkspaceNavigatorPane(
			self,
			options,
			on_action=navigator_action_handler,
			on_document=navigator_document_handler,
			on_document_close=navigator_document_close_handler,
		)
		self.chart_host = CentralChartHost(
			self,
			options,
			context_menu_handler=chart_context_menu_handler,
			resize_handler=chart_resize_handler,
		)

		self._body_sizer = wx.BoxSizer(wx.HORIZONTAL)
		self._body_sizer.Add(self.navigator_pane, 0, wx.EXPAND | wx.RIGHT, 12)
		self._body_sizer.Add(self.chart_host, 1, wx.EXPAND)
		self.SetSizer(self._body_sizer)

		self.refresh_theme()
		wx.CallAfter(self.refresh_navigation)

	def refresh_theme(self):
		background = _to_colour(self.options.clrbackground)
		self.SetBackgroundColour(background)
		self.navigator_pane.refresh_theme()
		self.chart_host.refresh_theme()

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

	def get_chart_host_size(self):
		return self.chart_host.get_chart_size()

	def refresh_chart(self):
		self.chart_host.refresh_host()

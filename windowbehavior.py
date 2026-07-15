# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import wx


def _focus_is_text_input():
	"""True when the focused widget is a text widget (or descendant of one)."""
	focus = wx.Window.FindFocus()
	if focus is None:
		return False
	try:
		import wx.stc as _stc
		stc_cls = _stc.StyledTextCtrl
	except Exception:
		stc_cls = None
	walker = focus
	while walker is not None:
		if isinstance(walker, (wx.TextCtrl, wx.SearchCtrl, wx.ComboBox)):
			return True
		if stc_cls is not None and isinstance(walker, stc_cls):
			return True
		walker = walker.GetParent() if hasattr(walker, 'GetParent') else None
	return False


def _close_window(window):
	try:
		if isinstance(window, wx.Dialog):
			try:
				if window.IsModal():
					try:
						window.EndModal(wx.ID_CANCEL)
						return True
					except Exception:
						pass
			except Exception:
				pass
		window.Close()
		return True
	except Exception:
		return False


def _dispatch_cmd_w(window, event):
	handler = getattr(window, 'onCloseWindowShortcut', None)
	if callable(handler):
		try:
			handler(event)
			return True
		except Exception:
			return False
	return _close_window(window)


def _menu_host(window):
	try:
		top = wx.GetTopLevelParent(window)
	except Exception:
		top = None
	if top is None:
		top = window
	return top


def set_menu_active(window, active=True):
	host = _menu_host(window)
	try:
		count = int(getattr(host, '_morinus_active_menu_count', 0))
	except Exception:
		count = 0
	if active:
		count += 1
	else:
		count = max(0, count - 1)
	host._morinus_active_menu_count = count
	return count


def has_active_menu(window):
	host = _menu_host(window)
	try:
		return int(getattr(host, '_morinus_active_menu_count', 0)) > 0
	except Exception:
		return False


def dismiss_active_menu(window):
	if not has_active_menu(window):
		return False
	try:
		simulator = wx.UIActionSimulator()
		simulator.KeyDown(wx.WXK_ESCAPE)
		simulator.KeyUp(wx.WXK_ESCAPE)
		return True
	except Exception:
		return False


def _bind_cmd_w(window):
	if getattr(window, "_morinus_cmdw_bound", False):
		return

	def _on_char_hook(event):
		try:
			keycode = event.GetKeyCode()
		except Exception:
			keycode = None
		try:
			cmd_down = event.CmdDown()
		except Exception:
			cmd_down = False
		try:
			alt_down = event.AltDown()
		except Exception:
			alt_down = False
		try:
			shift_down = event.ShiftDown()
		except Exception:
			shift_down = False

		if not cmd_down and not alt_down and not shift_down and keycode in (wx.WXK_RETURN, wx.WXK_NUMPAD_ENTER):
			# Never dismiss-menu-on-Enter when a text widget owns the
			# keyboard. Text widgets need Enter for newlines, and we've seen
			# the menu count drift non-zero (Cmd holds, etc.) and eat Enter
			# in the notes editor. Focus walker covers TextCtrl, STC,
			# SearchCtrl, ComboBox.
			if not _focus_is_text_input():
				if dismiss_active_menu(window):
					return

		if cmd_down and not alt_down and not shift_down and keycode in (ord('W'), ord('w')):
			if _dispatch_cmd_w(window, event):
				return

		event.Skip()

	window.Bind(wx.EVT_CHAR_HOOK, _on_char_hook)
	window._morinus_cmdw_bound = True


def install():
	if getattr(wx, "_morinus_windowbehavior_installed", False):
		return

	orig_frame_init = wx.Frame.__init__
	orig_dialog_init = wx.Dialog.__init__

	def frame_init(self, *args, **kwargs):
		orig_frame_init(self, *args, **kwargs)
		_bind_cmd_w(self)

	def dialog_init(self, *args, **kwargs):
		orig_dialog_init(self, *args, **kwargs)
		_bind_cmd_w(self)

	wx.Frame.__init__ = frame_init
	wx.Dialog.__init__ = dialog_init
	wx._morinus_windowbehavior_installed = True


def popup_menu(window, menu, event=None):
	top = _menu_host(window)

	try:
		top.Raise()
	except Exception:
		pass
	try:
		top.SetFocus()
	except Exception:
		pass

	pos = wx.DefaultPosition
	try:
		pos = event.GetPosition()
	except Exception:
		pass

	try:
		if hasattr(event, "GetEventType") and event.GetEventType() == wx.EVT_CONTEXT_MENU.typeId:
			pos = window.ScreenToClient(pos)
	except Exception:
		pass

	set_menu_active(top, True)
	try:
		window.PopupMenu(menu, pos)
	finally:
		set_menu_active(top, False)

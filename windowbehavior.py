# -*- coding: utf-8 -*-
import wx


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

		if cmd_down and not alt_down and not shift_down and keycode in (ord('W'), ord('w')):
			if _close_window(window):
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
	top = None
	try:
		top = wx.GetTopLevelParent(window)
	except Exception:
		top = None
	if top is None:
		top = window

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

	window.PopupMenu(menu, pos)

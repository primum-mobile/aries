# -*- coding: utf-8 -*-
import os
import wx
import horfileio


class HoroscopeChoiceDialog(wx.Dialog):
	def __init__(self, directory):
		wx.Dialog.__init__(self, None, -1, "Open Horoscope", size=(760, 520), style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
		self.directory = directory
		self.selected_path = ""

		main_sizer = wx.BoxSizer(wx.VERTICAL)
		self.path_label = wx.StaticText(self, -1, self.directory)
		main_sizer.Add(self.path_label, 0, wx.EXPAND | wx.ALL, 10)

		self.list = wx.ListCtrl(self, style=wx.LC_REPORT | wx.LC_SINGLE_SEL | wx.BORDER_SUNKEN)
		self.list.InsertColumn(0, "Name", width=180)
		self.list.InsertColumn(1, "Birth Date", width=120)
		self.list.InsertColumn(2, "Time", width=90)
		self.list.InsertColumn(3, "Location", width=260)
		main_sizer.Add(self.list, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 10)

		btn_sizer = wx.StdDialogButtonSizer()
		btn_ok = wx.Button(self, wx.ID_OK, "Open")
		btn_cancel = wx.Button(self, wx.ID_CANCEL, "Cancel")
		btn_sizer.AddButton(btn_ok)
		btn_sizer.AddButton(btn_cancel)
		btn_sizer.Realize()
		main_sizer.Add(btn_sizer, 0, wx.ALIGN_RIGHT | wx.ALL, 10)

		self.SetSizer(main_sizer)
		self._paths = []
		self._load_rows()
		self.list.Bind(wx.EVT_LIST_ITEM_ACTIVATED, self.onOpen)
		self.Bind(wx.EVT_BUTTON, self.onOpen, id=wx.ID_OK)

	def _load_rows(self):
		entries = []
		for name in os.listdir(self.directory):
			if name.startswith('.'):
				continue
			full = os.path.join(self.directory, name)
			if os.path.isfile(full):
				entries.append((name, full))
		entries.sort(key=lambda item: item[0].lower())

		for name, full in entries:
			summary = None
			try:
				summary = horfileio.read_hor_summary(full)
			except Exception:
				summary = None
			row = self.list.InsertItem(self.list.GetItemCount(), summary['name'] if summary and summary.get('name') else name)
			if summary:
				self.list.SetItem(row, 1, f"{summary['year']}.{str(summary['month']).zfill(2)}.{str(summary['day']).zfill(2)}")
				self.list.SetItem(row, 2, f"{str(summary['hour']).zfill(2)}:{str(summary['minute']).zfill(2)}:{str(summary['second']).zfill(2)}")
				self.list.SetItem(row, 3, summary.get('place', ''))
			self._paths.append(full)

		if self.list.GetItemCount() > 0:
			self.list.Select(0)
			self.list.Focus(0)

	def onOpen(self, event):
		index = self.list.GetFirstSelected()
		if index == -1:
			return
		self.selected_path = self._paths[index]
		self.EndModal(wx.ID_OK)


def choose_file(default_dir=None):
	default_dir = default_dir if default_dir and os.path.isdir(default_dir) else os.path.expanduser("~")
	try:
		dlg = HoroscopeChoiceDialog(default_dir)
		try:
			if dlg.ShowModal() != wx.ID_OK:
				return ""
			return dlg.selected_path or ""
		finally:
			dlg.Destroy()
	except Exception:
		return ""

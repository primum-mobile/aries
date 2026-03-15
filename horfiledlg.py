# -*- coding: utf-8 -*-
import os
import wx
import mtexts


class HoroscopeFileDialog(wx.Dialog):
	def __init__(self, parent, title, directory):
		wx.Dialog.__init__(self, parent, -1, title, size=(720, 520), style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)

		self.directory = directory if os.path.isdir(directory) else os.path.expanduser("~")
		self.selected_path = ''

		main_sizer = wx.BoxSizer(wx.VERTICAL)

		self.path_label = wx.StaticText(self, -1, self.directory)
		main_sizer.Add(self.path_label, 0, wx.EXPAND | wx.ALL, 10)

		self.listbox = wx.ListBox(self, -1)
		main_sizer.Add(self.listbox, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 10)

		button_row = wx.BoxSizer(wx.HORIZONTAL)
		self.change_dir_btn = wx.Button(self, -1, mtexts.txts.get('Open', 'Open Folder'))
		button_row.Add(self.change_dir_btn, 0, wx.RIGHT, 8)
		button_row.AddStretchSpacer()

		btn_sizer = wx.StdDialogButtonSizer()
		btn_ok = wx.Button(self, wx.ID_OK, mtexts.txts['Open'])
		btn_cancel = wx.Button(self, wx.ID_CANCEL, mtexts.txts['Cancel'])
		btn_sizer.AddButton(btn_ok)
		btn_sizer.AddButton(btn_cancel)
		btn_sizer.Realize()
		button_row.Add(btn_sizer, 0)
		main_sizer.Add(button_row, 0, wx.EXPAND | wx.ALL, 10)

		self.SetSizer(main_sizer)

		self.change_dir_btn.Bind(wx.EVT_BUTTON, self.onChangeDirectory)
		self.listbox.Bind(wx.EVT_LISTBOX_DCLICK, self.onOpen)
		self.Bind(wx.EVT_BUTTON, self.onOpen, id=wx.ID_OK)

		self._reload()

	def _reload(self):
		items = []
		try:
			for name in os.listdir(self.directory):
				if name.startswith('.'):
					continue
				full = os.path.join(self.directory, name)
				if os.path.isfile(full):
					items.append(name)
		except Exception:
			items = []

		items.sort(key=lambda item: item.lower())
		self.listbox.Set(items)
		if items:
			self.listbox.SetSelection(0)
		self.path_label.SetLabel(self.directory)
		self.Layout()

	def onChangeDirectory(self, event):
		dlg = wx.DirDialog(self, mtexts.txts.get('OpenHor', 'Open Horoscope'), self.directory)
		if dlg.ShowModal() == wx.ID_OK:
			self.directory = dlg.GetPath()
			self._reload()
		dlg.Destroy()

	def onOpen(self, event):
		selection = self.listbox.GetSelection()
		if selection == wx.NOT_FOUND:
			return
		filename = self.listbox.GetString(selection)
		self.selected_path = os.path.join(self.directory, filename)
		self.EndModal(wx.ID_OK)

	def GetPath(self):
		return self.selected_path

	def GetDirectory(self):
		return self.directory

# -*- coding: utf-8 -*-
import wx


class QuickChartsOptDlg(wx.Dialog):
	def __init__(self, parent):
		wx.Dialog.__init__(self, parent, -1, 'Supplementary Charts', size=wx.DefaultSize)

		mvsizer = wx.BoxSizer(wx.VERTICAL)

		box = wx.StaticBox(self, label='')
		boxsizer = wx.StaticBoxSizer(box, wx.VERTICAL)

		self.prompt_rb = wx.RadioButton(self, -1, 'Ask before opening', style=wx.RB_GROUP)
		self.instant_rb = wx.RadioButton(self, -1, 'Open immediately with current time + radix location')

		boxsizer.Add(self.prompt_rb, 0, wx.ALL, 5)
		boxsizer.Add(self.instant_rb, 0, wx.ALL, 5)
		boxsizer.Add(wx.StaticText(self, -1, 'Applies to Transits, Secondary Progressions, and Profections Chart.'), 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 5)

		mvsizer.Add(boxsizer, 0, wx.GROW | wx.ALL, 10)

		btnsizer = wx.StdDialogButtonSizer()
		btn_ok = wx.Button(self, wx.ID_OK)
		btn_ok.SetDefault()
		btnsizer.AddButton(btn_ok)
		btnsizer.AddButton(wx.Button(self, wx.ID_CANCEL))
		btnsizer.Realize()

		mvsizer.Add(btnsizer, 0, wx.GROW | wx.ALL, 10)
		self.SetSizerAndFit(mvsizer)

	def fill(self, opts):
		self.prompt_rb.SetValue(getattr(opts, 'quickcharts_prompt', True))
		self.instant_rb.SetValue(not getattr(opts, 'quickcharts_prompt', True))

	def check(self, opts):
		new_value = self.prompt_rb.GetValue()
		if getattr(opts, 'quickcharts_prompt', True) != new_value:
			opts.quickcharts_prompt = new_value
			return True
		return False

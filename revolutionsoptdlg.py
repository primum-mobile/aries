# -*- coding: utf-8 -*-

import wx


class RevolutionsOptDlg(wx.Dialog):

	YEAR_CURRENT = 0
	YEAR_NEXT = 1

	LOC_NATAL = 0
	LOC_ASK = 1

	def __init__(self, parent):
		wx.Dialog.__init__(self, parent, -1, 'Revolutions', size=wx.DefaultSize)

		root = wx.BoxSizer(wx.VERTICAL)

		# Solar: year mode
		year_box = wx.StaticBox(self, label='Solar Revolution — Year')
		year_sizer = wx.StaticBoxSizer(year_box, wx.VERTICAL)
		self.year_current = wx.RadioButton(self, -1, 'Current year', style=wx.RB_GROUP)
		self.year_next = wx.RadioButton(self, -1, 'Next year')
		year_sizer.Add(self.year_current, 0, wx.ALL, 4)
		year_sizer.Add(self.year_next, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 4)

		# Solar: location mode
		loc_box = wx.StaticBox(self, label='Solar Revolution — Location')
		loc_sizer = wx.StaticBoxSizer(loc_box, wx.VERTICAL)
		self.loc_natal = wx.RadioButton(self, -1, 'Use natal', style=wx.RB_GROUP)
		self.loc_ask = wx.RadioButton(self, -1, 'Ask')
		loc_sizer.Add(self.loc_natal, 0, wx.ALL, 4)
		loc_sizer.Add(self.loc_ask, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 4)

		# Lunar: location mode
		lloc_box = wx.StaticBox(self, label='Lunar Revolution — Location')
		lloc_sizer = wx.StaticBoxSizer(lloc_box, wx.VERTICAL)
		self.lloc_natal = wx.RadioButton(self, -1, 'Use natal', style=wx.RB_GROUP)
		self.lloc_ask = wx.RadioButton(self, -1, 'Ask')
		lloc_sizer.Add(self.lloc_natal, 0, wx.ALL, 4)
		lloc_sizer.Add(self.lloc_ask, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 4)

		# Mercury–Saturn: location mode
		ploc_box = wx.StaticBox(self, label='Mercury–Saturn — Location')
		ploc_sizer = wx.StaticBoxSizer(ploc_box, wx.VERTICAL)
		self.ploc_natal = wx.RadioButton(self, -1, 'Use natal', style=wx.RB_GROUP)
		self.ploc_ask = wx.RadioButton(self, -1, 'Ask')
		ploc_sizer.Add(self.ploc_natal, 0, wx.ALL, 4)
		ploc_sizer.Add(self.ploc_ask, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 4)

		root.Add(year_sizer,  0, wx.EXPAND | wx.ALL, 8)
		root.Add(loc_sizer,   0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
		root.Add(lloc_sizer,  0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
		root.Add(ploc_sizer,  0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

		btnsizer = wx.StdDialogButtonSizer()
		btn_ok = wx.Button(self, wx.ID_OK, 'OK')
		btn_cancel = wx.Button(self, wx.ID_CANCEL, 'Cancel')
		btn_ok.SetDefault()
		btnsizer.AddButton(btn_ok)
		btnsizer.AddButton(btn_cancel)
		btnsizer.Realize()
		root.Add(btnsizer, 0, wx.EXPAND | wx.ALL, 10)

		self.SetSizerAndFit(root)

	def fill(self, opts):
		if getattr(opts, 'revolutions_solaryearmode', self.YEAR_CURRENT) == self.YEAR_NEXT:
			self.year_next.SetValue(True)
		else:
			self.year_current.SetValue(True)

		if getattr(opts, 'revolutions_solarlocationmode', self.LOC_NATAL) == self.LOC_ASK:
			self.loc_ask.SetValue(True)
		else:
			self.loc_natal.SetValue(True)

		if getattr(opts, 'revolutions_lunarlocationmode', self.LOC_NATAL) == self.LOC_ASK:
			self.lloc_ask.SetValue(True)
		else:
			self.lloc_natal.SetValue(True)

		if getattr(opts, 'revolutions_planetslocationmode', self.LOC_NATAL) == self.LOC_ASK:
			self.ploc_ask.SetValue(True)
		else:
			self.ploc_natal.SetValue(True)

	def check(self, opts):
		changed = False

		yearmode  = self.YEAR_NEXT if self.year_next.GetValue() else self.YEAR_CURRENT
		locmode   = self.LOC_ASK if self.loc_ask.GetValue()   else self.LOC_NATAL
		llocmode  = self.LOC_ASK if self.lloc_ask.GetValue()  else self.LOC_NATAL
		plocmode  = self.LOC_ASK if self.ploc_ask.GetValue()  else self.LOC_NATAL

		if getattr(opts, 'revolutions_solaryearmode', self.YEAR_CURRENT) != yearmode:
			opts.revolutions_solaryearmode = yearmode
			changed = True

		if getattr(opts, 'revolutions_solarlocationmode', self.LOC_NATAL) != locmode:
			opts.revolutions_solarlocationmode = locmode
			changed = True

		if getattr(opts, 'revolutions_lunarlocationmode', self.LOC_NATAL) != llocmode:
			opts.revolutions_lunarlocationmode = llocmode
			changed = True

		if getattr(opts, 'revolutions_planetslocationmode', self.LOC_NATAL) != plocmode:
			opts.revolutions_planetslocationmode = plocmode
			changed = True

		return changed

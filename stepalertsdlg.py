# -*- coding: utf-8 -*-

import wx
import mtexts


class StepAlertsDlg(wx.Dialog):
	def __init__(self, parent, options):
		wx.Dialog.__init__(
			self,
			parent,
			id=wx.ID_ANY,
			title='Stepping Alerts',
			style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER,
		)
		self.options = options

		main = wx.BoxSizer(wx.VERTICAL)

		self.enableckb = wx.CheckBox(self, -1, 'Enable exact conjunction alerts')
		main.Add(self.enableckb, 0, wx.ALL, 8)

		content = wx.BoxSizer(wx.HORIZONTAL)

		prom_box = wx.StaticBox(self, label=mtexts.txts['Promissors'])
		prom_sizer = wx.StaticBoxSizer(prom_box, wx.VERTICAL)
		self.prom_ckbs = []
		for label in (
			mtexts.txts['Sun'], mtexts.txts['Moon'], mtexts.txts['Mercury'], mtexts.txts['Venus'],
			mtexts.txts['Mars'], mtexts.txts['Jupiter'], mtexts.txts['Saturn'], mtexts.txts['Uranus'],
			mtexts.txts['Neptune'], mtexts.txts['Pluto'], mtexts.txts['AscNode'], mtexts.txts['DescNode'],
		):
			ckb = wx.CheckBox(self, -1, label)
			self.prom_ckbs.append(ckb)
			prom_sizer.Add(ckb, 0, wx.ALL, 2)
		content.Add(prom_sizer, 0, wx.ALL, 8)

		sig_box = wx.StaticBox(self, label=mtexts.txts['Significators'])
		sig_sizer = wx.StaticBoxSizer(sig_box, wx.VERTICAL)
		self.sig_planet_ckbs = []
		for label in (
			mtexts.txts['Sun'], mtexts.txts['Moon'], mtexts.txts['Mercury'], mtexts.txts['Venus'],
			mtexts.txts['Mars'], mtexts.txts['Jupiter'], mtexts.txts['Saturn'], mtexts.txts['Uranus'],
			mtexts.txts['Neptune'], mtexts.txts['Pluto'], mtexts.txts['AscNode'], mtexts.txts['DescNode'],
		):
			ckb = wx.CheckBox(self, -1, label)
			self.sig_planet_ckbs.append(ckb)
			sig_sizer.Add(ckb, 0, wx.ALL, 2)

		angles_box = wx.StaticBox(self, label='Angles')
		angles_sizer = wx.StaticBoxSizer(angles_box, wx.VERTICAL)
		self.sig_angle_ckbs = []
		for label in (mtexts.txts['Asc'], mtexts.txts['Dsc'], mtexts.txts['MC'], mtexts.txts['IC']):
			ckb = wx.CheckBox(self, -1, label)
			self.sig_angle_ckbs.append(ckb)
			angles_sizer.Add(ckb, 0, wx.ALL, 2)
		sig_sizer.Add(angles_sizer, 0, wx.TOP | wx.EXPAND, 8)
		content.Add(sig_sizer, 0, wx.ALL, 8)

		main.Add(content, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 4)

		note = wx.StaticText(self, -1, 'Alerts fire for exact conjunctions within 1° in stepped comparison charts.')
		main.Add(note, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

		btns = wx.StdDialogButtonSizer()
		ok = wx.Button(self, wx.ID_OK, mtexts.txts['Ok'])
		cancel = wx.Button(self, wx.ID_CANCEL, mtexts.txts['Cancel'])
		btns.AddButton(ok)
		btns.AddButton(cancel)
		btns.Realize()
		main.Add(btns, 0, wx.EXPAND | wx.ALL, 10)

		self.SetSizerAndFit(main)

	def fill(self):
		self.enableckb.SetValue(getattr(self.options, 'stepalerts_enabled', True))
		for i, ckb in enumerate(self.prom_ckbs):
			ckb.SetValue(self.options.stepalerts_promplanets[i])
		for i, ckb in enumerate(self.sig_planet_ckbs):
			ckb.SetValue(self.options.stepalerts_sigplanets[i])
		for i, ckb in enumerate(self.sig_angle_ckbs):
			ckb.SetValue(self.options.stepalerts_sigangles[i])

	def check(self):
		changed = False
		if self.options.stepalerts_enabled != self.enableckb.GetValue():
			self.options.stepalerts_enabled = self.enableckb.GetValue()
			changed = True

		for i, ckb in enumerate(self.prom_ckbs):
			if self.options.stepalerts_promplanets[i] != ckb.GetValue():
				self.options.stepalerts_promplanets[i] = ckb.GetValue()
				changed = True

		for i, ckb in enumerate(self.sig_planet_ckbs):
			if self.options.stepalerts_sigplanets[i] != ckb.GetValue():
				self.options.stepalerts_sigplanets[i] = ckb.GetValue()
				changed = True

		for i, ckb in enumerate(self.sig_angle_ckbs):
			if self.options.stepalerts_sigangles[i] != ckb.GetValue():
				self.options.stepalerts_sigangles[i] = ckb.GetValue()
				changed = True

		return changed

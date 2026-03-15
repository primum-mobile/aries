# -*- coding: utf-8 -*-
import wx
import mtexts
import secdir
import chart


class StepperDlg(wx.Dialog):

	def _is_outside_ephem(self, y, m, d):
		# 에피메리스 상 유효 범위: 0001-01-01 ≤ date ≤ 5000-12-31
		if y < 1 or (y == 1 and (m, d) < (1, 1)):
			return True
		if y > 5000 or (y == 5000 and (m, d) > (12, 31)):
			return True
		return False

	def __init__(self, parent, chrt, age, direct, soltime, options, caption):
		wx.Dialog.__init__(self, parent, -1, mtexts.txts['SecondaryDirs'], pos=wx.DefaultPosition, size=wx.DefaultSize, style=wx.DEFAULT_DIALOG_STYLE|wx.STAY_ON_TOP)

		self.parent = parent
		self.chart = chrt
		self.age = age
		if not direct:
			self.age *= -1
#		self.direct = direct
		self.soltime = soltime
		self.options = options
		self.caption = caption
		self.ID_ARROW_PREV = wx.NewId()
		self.ID_ARROW_NEXT = wx.NewId()

		#main vertical sizer
		mvsizer = wx.BoxSizer(wx.VERTICAL)

		ID_Incr = wx.NewId()
		ID_Decr = wx.NewId()
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		sdays =wx.StaticBox(self, label=mtexts.txts['Days'])
		dayssizer = wx.StaticBoxSizer(sdays, wx.HORIZONTAL)
		self.daytxt = wx.TextCtrl(self, -1, '', size=(50,-1), style=wx.TE_READONLY)
		self.daytxt.SetValue(str(self.age))
		vsizer = wx.BoxSizer(wx.VERTICAL)
		vsizer.Add(self.daytxt, 0, wx.ALIGN_CENTER)
		btnIncr = wx.Button(self, ID_Incr, '++', size=(60,40))
		hsizer.Add(btnIncr, 0, wx.ALIGN_CENTER|wx.ALL, 5)
		btnDecr = wx.Button(self, ID_Decr, '--', size=(60,40))
		hsizer.Add(btnDecr, 0, wx.ALIGN_CENTER|wx.ALL, 5)
		vsizer.Add(hsizer, 0, wx.ALIGN_CENTER|wx.ALL, 5)

		dayssizer.Add(vsizer, 0, wx.ALIGN_CENTER|wx.TOP, 5)
		
		mvsizer.Add(dayssizer, 0, wx.ALIGN_CENTER)

		btnsizer = wx.StdDialogButtonSizer()

		btn = wx.Button(self, wx.ID_OK, mtexts.txts['Ok'])
		btnsizer.AddButton(btn)
		btn.SetDefault()

		btnsizer.Realize()

		mvsizer.Add(btnsizer, 0, wx.GROW|wx.ALL, 10)
		self.SetSizer(mvsizer)
		mvsizer.Fit(self)

		btn.SetFocus()

		self.Bind(wx.EVT_BUTTON, self.onIncr, id=ID_Incr)
		self.Bind(wx.EVT_BUTTON, self.onDecr, id=ID_Decr)
		self.Bind(wx.EVT_BUTTON, self.onClose, id=wx.ID_OK)
		self.Bind(wx.EVT_BUTTON, self.onClose, id=wx.ID_CLOSE)
		self.Bind(wx.EVT_CLOSE, self.onClose)
		self.Bind(wx.EVT_MENU, self.onArrowPrev, id=self.ID_ARROW_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowNext, id=self.ID_ARROW_NEXT)
		self.Bind(wx.EVT_CHAR_HOOK, self.onCharHook)
		self.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		self.daytxt.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		btnIncr.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		btnDecr.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		btn.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)

		self.zt = chart.Time.LOCALMEAN
		if self.soltime:
			self.zt = chart.Time.LOCALAPPARENT
		self.zh = 0
		self.zm = 0
		self._arrow_prev = self.onDecr
		self._arrow_next = self.onIncr
		self.SetAcceleratorTable(wx.AcceleratorTable([
			(0, wx.WXK_LEFT, self.ID_ARROW_PREV),
			(0, wx.WXK_RIGHT, self.ID_ARROW_NEXT),
		]))

	def onCharHook(self, event):
		if event is None:
			return
		if event.AltDown() or event.ControlDown() or event.CmdDown():
			event.Skip()
			return
		if event.GetKeyCode() == wx.WXK_TAB:
			if hasattr(self.parent, "toggleComparisonView"):
				self.parent.toggleComparisonView()
			return
		if event.GetKeyCode() == wx.WXK_LEFT:
			self._arrow_prev(None)
			return
		if event.GetKeyCode() == wx.WXK_RIGHT:
			self._arrow_next(None)
			return
		event.Skip()

	def onKeyDown(self, event):
		if event is None:
			return
		if event.AltDown() or event.ControlDown() or event.CmdDown():
			event.Skip()
			return
		if event.GetKeyCode() == wx.WXK_TAB:
			if hasattr(self.parent, "toggleComparisonView"):
				self.parent.toggleComparisonView()
			return
		if event.GetKeyCode() == wx.WXK_LEFT:
			self._arrow_prev(None)
			return
		if event.GetKeyCode() == wx.WXK_RIGHT:
			self._arrow_next(None)
			return
		event.Skip()

	def onArrowPrev(self, event):
		self._arrow_prev(None)

	def onArrowNext(self, event):
		self._arrow_next(None)

	def step_backward(self):
		self._arrow_prev(None)

	def step_forward(self):
		self._arrow_next(None)


	def onIncr(self, event):
		self._arrow_prev = self.onDecr
		self._arrow_next = self.onIncr
		prev_age = self.age
		self.age += 1
		self.daytxt.SetValue(str(self.age))
		direct = True
		age = self.age
		if self.age < 0:
			age *= -1
			direct = False
		sdir = secdir.SecDir(self.chart, age, direct, self.soltime)
		y, m, d, hour, minute, second = sdir.compute()

		time = chart.Time(y, m, d, hour, minute, second, False, self.chart.time.cal, self.zt, self.chart.time.plus, self.zh, self.zm, False, self.chart.place, False)
		# 범위 검사 선행
		if self._is_outside_ephem(y, m, d):
			# ← 요청사항: Days(=self.age)와 표시값까지 이전 상태로 원복
			self.age = prev_age
			self.daytxt.SetValue(str(self.age))
			wx.MessageBox(mtexts.txts['RangeError2'], mtexts.txts['Error'],
						  wx.OK | wx.ICON_EXCLAMATION, self)
			return

		time = chart.Time(y, m, d, hour, minute, second, False, self.chart.time.cal, self.zt, self.chart.time.plus, self.zh, self.zm, False, self.chart.place, False)
		chrt = chart.Chart(self.chart.name, self.chart.male, time, self.chart.place, chart.Chart.TRANSIT, '', self.options, False)

		self.parent.change(chrt, self.caption)


	def onDecr(self, event):
		self._arrow_prev = self.onDecr
		self._arrow_next = self.onIncr
		prev_age = self.age
		self.age -= 1
		self.daytxt.SetValue(str(self.age))
		direct = True
		age = self.age
		if self.age < 0:
			age *= -1
			direct = False
		sdir = secdir.SecDir(self.chart, age, direct, self.soltime)
		y, m, d, hour, minute, second = sdir.compute()

		if self._is_outside_ephem(y, m, d):
			self.age = prev_age
			self.daytxt.SetValue(str(self.age))
			wx.MessageBox(mtexts.txts['RangeError2'], mtexts.txts['Error'],
						  wx.OK | wx.ICON_EXCLAMATION, self)
			return

		time = chart.Time(y, m, d, hour, minute, second, False, self.chart.time.cal, self.zt, self.chart.time.plus, self.zh, self.zm, False, self.chart.place, False)
		chrt = chart.Chart(self.chart.name, self.chart.male, time, self.chart.place, chart.Chart.TRANSIT, '', self.options, False)

		self.parent.change(chrt, self.caption)


	def onClose(self, event):
		try:
			self.Hide()
		except Exception:
			pass
		try:
			if event is not None and hasattr(event, "Veto"):
				event.Veto()
		except Exception:
			pass
		try:
			wx.CallAfter(self.parent.Raise)
			wx.CallAfter(self.parent.SetFocus)
			if hasattr(self.parent, "w"):
				wx.CallAfter(self.parent.w.SetFocus)
		except Exception:
			pass

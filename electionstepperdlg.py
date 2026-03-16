import wx
import mtexts
import chart
import util


class ElectionStepperDlg(wx.Dialog):
	def __init__(self, parent, chrt, options, caption, on_step=None):
		wx.Dialog.__init__(self, parent, -1, mtexts.txts['Elections'], pos=wx.DefaultPosition, size=wx.DefaultSize, style=wx.DEFAULT_DIALOG_STYLE|wx.STAY_ON_TOP)

		self.parent = parent
		self._on_step = on_step
		self.chart = chrt
		self.options = options
		self.caption = caption
		self.ID_ARROW_PREV = wx.NewId()
		self.ID_ARROW_NEXT = wx.NewId()
		self._arrow_prev = self.onDecrYear
		self._arrow_next = self.onIncrYear

		#main vertical sizer
		mvsizer = wx.BoxSizer(wx.VERTICAL)

		ID_IncrYear = wx.NewId()
		ID_DecrYear = wx.NewId()
		ID_IncrMonth = wx.NewId()
		ID_DecrMonth = wx.NewId()
		ID_IncrDay = wx.NewId()
		ID_DecrDay = wx.NewId()
		ID_IncrHour = wx.NewId()
		ID_DecrHour = wx.NewId()
		ID_IncrMin = wx.NewId()
		ID_DecrMin = wx.NewId()
		ID_IncrSec = wx.NewId()
		ID_DecrSec = wx.NewId()
		sb = wx.StaticBox(self, label='')
		sbsizer = wx.StaticBoxSizer(sb, wx.VERTICAL)

		gsizer = wx.FlexGridSizer(6, 2,9,24)

		label = wx.StaticText(self, -1, mtexts.txts['Year'])
		gsizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)
		btnIncrYear = wx.Button(self, ID_IncrYear, '++', size=(40,30))
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		hsizer.Add(btnIncrYear, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		btnDecrYear = wx.Button(self, ID_DecrYear, '--', size=(40,30))
		hsizer.Add(btnDecrYear, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		gsizer.Add(hsizer, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)

		label = wx.StaticText(self, -1, mtexts.txts['Month'])
		gsizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)
		btnIncrMonth = wx.Button(self, ID_IncrMonth, '++', size=(40,30))
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		hsizer.Add(btnIncrMonth, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		btnDecrMonth = wx.Button(self, ID_DecrMonth, '--', size=(40,30))
		hsizer.Add(btnDecrMonth, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		gsizer.Add(hsizer, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)

		label = wx.StaticText(self, -1, mtexts.txts['Day'])
		gsizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)
		btnIncrDay = wx.Button(self, ID_IncrDay, '++', size=(40,30))
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		hsizer.Add(btnIncrDay, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		btnDecrDay = wx.Button(self, ID_DecrDay, '--', size=(40,30))
		hsizer.Add(btnDecrDay, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		gsizer.Add(hsizer, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)

		label = wx.StaticText(self, -1, mtexts.txts['Hour'])
		gsizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)
		btnIncrHour = wx.Button(self, ID_IncrHour, '++', size=(40,30))
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		hsizer.Add(btnIncrHour, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		btnDecrHour = wx.Button(self, ID_DecrHour, '--', size=(40,30))
		hsizer.Add(btnDecrHour, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		gsizer.Add(hsizer, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)

		label = wx.StaticText(self, -1, mtexts.txts['Min'])
		gsizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)
		btnIncrMin = wx.Button(self, ID_IncrMin, '++', size=(40,30))
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		hsizer.Add(btnIncrMin, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		btnDecrMin = wx.Button(self, ID_DecrMin, '--', size=(40,30))
		hsizer.Add(btnDecrMin, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		gsizer.Add(hsizer, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)

		label = wx.StaticText(self, -1, mtexts.txts['Sec'])
		gsizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)
		btnIncrSec = wx.Button(self, ID_IncrSec, '++', size=(40,30))
		hsizer = wx.BoxSizer(wx.HORIZONTAL)
		hsizer.Add(btnIncrSec, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		btnDecrSec = wx.Button(self, ID_DecrSec, '--', size=(40,30))
		hsizer.Add(btnDecrSec, 0, wx.ALIGN_CENTER|wx.ALL, 2)
		gsizer.Add(hsizer, 0, wx.ALIGN_CENTER_VERTICAL|wx.ALL, 2)

		sbsizer.Add(gsizer, 0, wx.ALIGN_CENTER|wx.ALL, 5)
    
		mvsizer.Add(sbsizer, 0, wx.ALIGN_CENTER)

		btnsizer = wx.StdDialogButtonSizer()

		btn = wx.Button(self, wx.ID_OK, mtexts.txts['Ok'])
		btnsizer.AddButton(btn)
		btn.SetDefault()

		btnsizer.Realize()

		mvsizer.Add(btnsizer, 0, wx.GROW|wx.ALL, 10)
		self.SetSizer(mvsizer)
		mvsizer.Fit(self)

		btn.SetFocus()

		self.Bind(wx.EVT_BUTTON, self.onIncrYear, id=ID_IncrYear)
		self.Bind(wx.EVT_BUTTON, self.onDecrYear, id=ID_DecrYear)
		self.Bind(wx.EVT_BUTTON, self.onIncrMonth, id=ID_IncrMonth)
		self.Bind(wx.EVT_BUTTON, self.onDecrMonth, id=ID_DecrMonth)
		self.Bind(wx.EVT_BUTTON, self.onIncrDay, id=ID_IncrDay)
		self.Bind(wx.EVT_BUTTON, self.onDecrDay, id=ID_DecrDay)
		self.Bind(wx.EVT_BUTTON, self.onIncrHour, id=ID_IncrHour)
		self.Bind(wx.EVT_BUTTON, self.onDecrHour, id=ID_DecrHour)
		self.Bind(wx.EVT_BUTTON, self.onIncrMin, id=ID_IncrMin)
		self.Bind(wx.EVT_BUTTON, self.onDecrMin, id=ID_DecrMin)
		self.Bind(wx.EVT_BUTTON, self.onIncrSec, id=ID_IncrSec)
		self.Bind(wx.EVT_BUTTON, self.onDecrSec, id=ID_DecrSec)
		self.Bind(wx.EVT_BUTTON, self.onClose, id=wx.ID_OK)
		self.Bind(wx.EVT_BUTTON, self.onClose, id=wx.ID_CLOSE)
		self.Bind(wx.EVT_CLOSE, self.onClose)
		self.Bind(wx.EVT_MENU, self.onArrowPrev, id=self.ID_ARROW_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowNext, id=self.ID_ARROW_NEXT)
		self.Bind(wx.EVT_CHAR_HOOK, self.onCharHook)
		self.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		for child in self.GetChildren():
			try:
				child.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
			except Exception:
				pass
		self.SetAcceleratorTable(wx.AcceleratorTable([
			(0, wx.WXK_LEFT, self.ID_ARROW_PREV),
			(0, wx.WXK_RIGHT, self.ID_ARROW_NEXT),
		]))

	def onCharHook(self, event):
		if event is None:
			return
		if self.handle_navigation_key(
			event.GetKeyCode(),
			shift_down=event.ShiftDown(),
			alt_down=event.AltDown(),
			control_down=event.ControlDown(),
			cmd_down=event.CmdDown(),
		):
			return
		event.Skip()

	def onKeyDown(self, event):
		if event is None:
			return
		if self.handle_navigation_key(
			event.GetKeyCode(),
			shift_down=event.ShiftDown(),
			alt_down=event.AltDown(),
			control_down=event.ControlDown(),
			cmd_down=event.CmdDown(),
		):
			return
		event.Skip()

	def _toggle_comparison(self):
		if hasattr(self.parent, "toggleComparisonView"):
			self.parent.toggleComparisonView()
		elif hasattr(self.parent, "_active_chart_session"):
			cs = self.parent._active_chart_session()
			if cs is not None:
				cs.toggleComparisonView()

	def handle_navigation_key(self, keycode, shift_down=False, alt_down=False, control_down=False, cmd_down=False):
		if control_down or cmd_down:
			return False

		if keycode == wx.WXK_TAB:
			self._toggle_comparison()
			return True

		if keycode not in (wx.WXK_LEFT, wx.WXK_RIGHT):
			return False

		delta = -1 if keycode == wx.WXK_LEFT else 1
		unit = 'day'
		if alt_down:
			unit = 'minute'
		elif shift_down:
			unit = 'hour'

		if hasattr(self.parent, 'navigate_relative') and self.parent.navigate_relative(unit, delta):
			self.chart = self.parent.chart
			self._arrow_prev = self.onDecrDay if unit == 'day' else self.onDecrHour if unit == 'hour' else self.onDecrMin
			self._arrow_next = self.onIncrDay if unit == 'day' else self.onIncrHour if unit == 'hour' else self.onIncrMin
			return True

		if unit == 'day':
			if delta < 0:
				self.onDecrDay(None)
			else:
				self.onIncrDay(None)
		elif unit == 'hour':
			if delta < 0:
				self.onDecrHour(None)
			else:
				self.onIncrHour(None)
		else:
			if delta < 0:
				self.onDecrMin(None)
			else:
				self.onIncrMin(None)
		return True

	def onArrowPrev(self, event):
		self._arrow_prev(None)

	def onArrowNext(self, event):
		self._arrow_next(None)

	def step_backward(self):
		self._arrow_prev(None)

	def step_forward(self):
		self._arrow_next(None)


	def onIncrYear(self, event):
		self._arrow_prev = self.onDecrYear
		self._arrow_next = self.onIncrYear
		y = self.chart.time.origyear+1
		self.show(y, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, self.chart.time.second)


	def onDecrYear(self, event):
		self._arrow_prev = self.onDecrYear
		self._arrow_next = self.onIncrYear
		y = self.chart.time.origyear-1
		self.show(y, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, self.chart.time.second)


	def onIncrMonth(self, event):
		self._arrow_prev = self.onDecrMonth
		self._arrow_next = self.onIncrMonth
		y, m = util.incrMonth(self.chart.time.origyear, self.chart.time.origmonth)
		self.show(y, m, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, self.chart.time.second)


	def onDecrMonth(self, event):
		self._arrow_prev = self.onDecrMonth
		self._arrow_next = self.onIncrMonth
		y, m = util.decrMonth(self.chart.time.origyear, self.chart.time.origmonth)
		self.show(y, m, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, self.chart.time.second)


	def onIncrDay(self, event):
		self._arrow_prev = self.onDecrDay
		self._arrow_next = self.onIncrDay
		y, m, d = util.incrDay(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday)
		self.show(y, m, d, self.chart.time.hour, self.chart.time.minute, self.chart.time.second)


	def onDecrDay(self, event):
		self._arrow_prev = self.onDecrDay
		self._arrow_next = self.onIncrDay
		y, m, d = util.decrDay(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday)
		self.show(y, m, d, self.chart.time.hour, self.chart.time.minute, self.chart.time.second)


	def onIncrHour(self, event):
		self._arrow_prev = self.onDecrHour
		self._arrow_next = self.onIncrHour
		y, m, d, h = util.addHour(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour)
		self.show(y, m, d, h, self.chart.time.minute, self.chart.time.second)


	def onDecrHour(self, event):
		self._arrow_prev = self.onDecrHour
		self._arrow_next = self.onIncrHour
		y, m, d, h = util.subtractHour(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour)
		self.show(y, m, d, h, self.chart.time.minute, self.chart.time.second)


	def onIncrMin(self, event):
		self._arrow_prev = self.onDecrMin
		self._arrow_next = self.onIncrMin
		y, m, d, h, mi = util.addMins(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, 1)
		self.show(y, m, d, h, mi, self.chart.time.second)


	def onDecrMin(self, event):
		self._arrow_prev = self.onDecrMin
		self._arrow_next = self.onIncrMin
		y, m, d, h, mi = util.subtractMins(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, 1)
		self.show(y, m, d, h, mi, self.chart.time.second)


	def onIncrSec(self, event):
		self._arrow_prev = self.onDecrSec
		self._arrow_next = self.onIncrSec
		y, m, d, h, mi, s = util.addSecs(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, self.chart.time.second, 1)
		self.show(y, m, d, h, mi, s)


	def onDecrSec(self, event):
		self._arrow_prev = self.onDecrSec
		self._arrow_next = self.onIncrSec
		y, m, d, h, mi, s = util.subtractSecs(self.chart.time.origyear, self.chart.time.origmonth, self.chart.time.origday, self.chart.time.hour, self.chart.time.minute, self.chart.time.second, 1)
		self.show(y, m, d, h, mi, s)


	def show(self, y, m, d, h, mi, s):
		time = chart.Time(y, m, d, h, mi, s, self.chart.time.bc, self.chart.time.cal, self.chart.time.zt, self.chart.time.plus, self.chart.time.zh, self.chart.time.zm, self.chart.time.daylightsaving, self.chart.place, False, tzid=getattr(self.chart.time, 'tzid', ''), tzauto=getattr(self.chart.time, 'tzauto', False))
		chrt = chart.Chart(self.chart.name, self.chart.male, time, self.chart.place, chart.Chart.TRANSIT, '', self.options, False)
		if self._on_step is not None:
			self._on_step(chrt, self.caption)
		else:
			self.parent.change(chrt, self.caption)
		del self.chart
		self.chart = chrt


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

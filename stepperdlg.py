# -*- coding: utf-8 -*-
import wx
import mtexts
import secdir
import chart
import symbolic_time
import astrology
import util
import math


class StepperDlg(wx.Dialog):
	WEEK_STEP_DAYS = 7
	DAY_STEP_DAYS = 1

	def _is_outside_ephem(self, y, m, d):
		# 에피메리스 상 유효 범위: 0001-01-01 ≤ date ≤ 5000-12-31
		if y < 1 or (y == 1 and (m, d) < (1, 1)):
			return True
		if y > 5000 or (y == 5000 and (m, d) > (12, 31)):
			return True
		return False

	def _calflag(self):
		if getattr(self.chart.time, 'cal', chart.Time.GREGORIAN) == chart.Time.JULIAN:
			return astrology.SE_JUL_CAL
		return astrology.SE_GREG_CAL

	def _is_leap_year(self, year_value):
		year_value = int(year_value)
		if self._calflag() == astrology.SE_JUL_CAL:
			return year_value % 4 == 0
		return (year_value % 4 == 0 and (year_value % 100 != 0 or year_value % 400 == 0))

	def _days_in_month(self, year_value, month_value):
		if month_value == 2:
			return 29 if self._is_leap_year(year_value) else 28
		if month_value in (4, 6, 9, 11):
			return 30
		return 31

	def _current_signified_datetime(self):
		direct = self.age >= 0.0
		age_abs = math.fabs(float(self.age))
		sdir = secdir.SecDir(self.chart, age_abs, direct, self.soltime)
		y, m, d, hour, minute, second = sdir.compute()
		directed_chart = chart.Chart(self.chart.name, self.chart.male,
			chart.Time(y, m, d, hour, minute, second, False, self.chart.time.cal, self.zt,
					   self.chart.time.plus, self.zh, self.zm, False, self.chart.place, False),
			self.chart.place, chart.Chart.TRANSIT, '', self.options, False)
		info = symbolic_time.secondary_direction_symbolic_info(self.chart, directed_chart)
		if info is None:
			return None
		return info['signified_datetime']

	def _symbolic_age_from_signified(self, signified_dt):
		if signified_dt is None:
			return None
		y, m, d, h, mi, s = signified_dt
		real_ut = float(h) + float(mi) / 60.0 + float(s) / 3600.0
		target_jd = astrology.swe_julday(int(y), int(m), int(d), real_ut, self._calflag())
		return self._solve_symbolic_age_for_signified_jd(target_jd)

	def _signified_jd_for_symbolic_age(self, symbolic_age):
		direct = symbolic_age >= 0.0
		age_abs = math.fabs(float(symbolic_age))
		sdir = secdir.SecDir(self.chart, age_abs, direct, self.soltime)
		y, m, d, hour, minute, second = sdir.compute()
		if self._is_outside_ephem(y, m, d):
			return None
		directed_chart = chart.Chart(self.chart.name, self.chart.male,
			chart.Time(y, m, d, hour, minute, second, False, self.chart.time.cal, self.zt,
					   self.chart.time.plus, self.zh, self.zm, False, self.chart.place, False),
			self.chart.place, chart.Chart.TRANSIT, '', self.options, False)
		info = symbolic_time.secondary_direction_symbolic_info(self.chart, directed_chart)
		if info is None:
			return None
		sy, sm, sd, sh, smi, ss = info['signified_datetime']
		signified_ut = float(sh) + float(smi) / 60.0 + float(ss) / 3600.0
		return astrology.swe_julday(int(sy), int(sm), int(sd), signified_ut, self._calflag())

	def _solve_symbolic_age_for_signified_jd(self, target_jd):
		current_age = float(self.age)
		current_jd = self._signified_jd_for_symbolic_age(current_age)
		if current_jd is None:
			return None
		if abs(float(target_jd) - float(current_jd)) < 1e-10:
			return current_age

		if target_jd > current_jd:
			lo = current_age
			lo_jd = current_jd
			hi = current_age + max((target_jd - current_jd) / 365.2425, 0.01)
			hi_jd = self._signified_jd_for_symbolic_age(hi)
			if hi_jd is None:
				return None
			for _ in range(40):
				if hi_jd >= target_jd:
					break
				step = max((hi - lo) * 2.0, 0.01)
				lo = hi
				lo_jd = hi_jd
				hi = hi + step
				hi_jd = self._signified_jd_for_symbolic_age(hi)
				if hi_jd is None:
					return None
		else:
			hi = current_age
			hi_jd = current_jd
			lo = current_age - max((current_jd - target_jd) / 365.2425, 0.01)
			lo_jd = self._signified_jd_for_symbolic_age(lo)
			if lo_jd is None:
				return None
			for _ in range(40):
				if lo_jd <= target_jd:
					break
				step = max((hi - lo) * 2.0, 0.01)
				hi = lo
				hi_jd = lo_jd
				lo = lo - step
				lo_jd = self._signified_jd_for_symbolic_age(lo)
				if lo_jd is None:
					return None

		for _ in range(40):
			mid = (lo + hi) * 0.5
			mid_jd = self._signified_jd_for_symbolic_age(mid)
			if mid_jd is None:
				return None
			if mid_jd < target_jd:
				lo = mid
				lo_jd = mid_jd
			else:
				hi = mid
				hi_jd = mid_jd

		if abs(target_jd - lo_jd) <= abs(hi_jd - target_jd):
			return lo
		return hi

	def _shift_signified_datetime(self, signified_dt, unit, delta):
		y, m, d, h, mi, s = signified_dt
		if unit == 'year':
			y += int(delta)
			d = min(int(d), self._days_in_month(int(y), int(m)))
			return int(y), int(m), int(d), int(h), int(mi), int(s)
		if unit == 'month':
			steps = abs(int(delta))
			for _ in range(steps):
				if delta > 0:
					y, m = util.incrMonth(int(y), int(m))
				else:
					y, m = util.decrMonth(int(y), int(m))
			d = min(int(d), self._days_in_month(int(y), int(m)))
			return int(y), int(m), int(d), int(h), int(mi), int(s)
		if unit == 'week':
			total_days = int(delta) * self.WEEK_STEP_DAYS
			if total_days > 0:
				for _ in range(total_days):
					y, m, d = util.incrDay(int(y), int(m), int(d))
			else:
				for _ in range(-total_days):
					y, m, d = util.decrDay(int(y), int(m), int(d))
			return int(y), int(m), int(d), int(h), int(mi), int(s)
		if unit == 'day':
			total_days = int(delta)
			if total_days > 0:
				for _ in range(total_days):
					y, m, d = util.incrDay(int(y), int(m), int(d))
			else:
				for _ in range(-total_days):
					y, m, d = util.decrDay(int(y), int(m), int(d))
			return int(y), int(m), int(d), int(h), int(mi), int(s)
		return signified_dt

	def __init__(self, parent, chrt, age, direct, soltime, options, caption, on_step=None):
		wx.Dialog.__init__(self, parent, -1, mtexts.txts['SecondaryDirs'], pos=wx.DefaultPosition, size=wx.DefaultSize, style=wx.DEFAULT_DIALOG_STYLE|wx.STAY_ON_TOP)

		self.parent = parent
		self._on_step = on_step
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

	def _toggle_comparison(self):
		if hasattr(self.parent, "toggleComparisonView"):
			self.parent.toggleComparisonView()
		elif hasattr(self.parent, "_active_chart_session"):
			cs = self.parent._active_chart_session()
			if cs is not None:
				cs.toggleComparisonView()

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

	def handle_navigation_key(self, keycode, shift_down=False, alt_down=False, control_down=False, cmd_down=False):
		if control_down or cmd_down:
			return False

		if keycode in (wx.WXK_SPACE, ord(' ')):
			if hasattr(self.parent, '_active_chart_session'):
				cs = self.parent._active_chart_session()
				if cs is not None and hasattr(cs, 'reset_to_initial_chart') and cs.reset_to_initial_chart():
					self._sync_age_from_active_session_chart()
					return True
			return False

		if keycode == wx.WXK_TAB:
			self._toggle_comparison()
			return True

		if keycode in (wx.WXK_UP, wx.WXK_DOWN):
			delta = 1 if keycode == wx.WXK_UP else -1
			self._step_real_time('year', delta)
			return True

		if keycode in (wx.WXK_LEFT, wx.WXK_RIGHT):
			if alt_down:
				unit = 'day'
			elif shift_down:
				unit = 'week'
			else:
				unit = 'month'
			delta = -1 if keycode == wx.WXK_LEFT else 1
			self._step_real_time(unit, delta)
			return True

		return False

	def onArrowPrev(self, event):
		self._step_real_time('month', -1)

	def onArrowNext(self, event):
		self._step_real_time('month', 1)

	def step_backward(self):
		self._step_real_time('month', -1)

	def step_forward(self):
		self._step_real_time('month', 1)

	def _format_age_value(self, value):
		f = float(value)
		if abs(f - round(f)) < 1e-9:
			return str(int(round(f)))
		txt = '%.6f' % f
		while txt.endswith('0'):
			txt = txt[:-1]
		if txt.endswith('.'):
			txt = txt[:-1]
		return txt

	def _sync_age_from_active_session_chart(self):
		if not hasattr(self.parent, '_active_chart_session'):
			return
		cs = self.parent._active_chart_session()
		if cs is None or cs.chart is None:
			return
		info = symbolic_time.secondary_direction_symbolic_info(self.chart, cs.chart)
		if info is None:
			return
		self.age = float(info.get('delta_symbolic_days', self.age))
		self.daytxt.SetValue(self._format_age_value(self.age))

	def _step_real_time(self, unit, delta):
		current_signified = self._current_signified_datetime()
		if current_signified is None:
			return
		target_signified = self._shift_signified_datetime(current_signified, unit, delta)
		symbolic_age = self._symbolic_age_from_signified(target_signified)
		if symbolic_age is None:
			return
		self._step_to_symbolic_age(symbolic_age)

	def _step_to_symbolic_age(self, symbolic_age):
		symbolic_age = float(symbolic_age)
		if abs(symbolic_age - float(self.age)) < 1e-12:
			return

		self._arrow_prev = self.onDecr
		self._arrow_next = self.onIncr
		prev_age = self.age
		self.age = symbolic_age
		self.daytxt.SetValue(self._format_age_value(self.age))

		direct = True
		age = math.fabs(float(self.age))
		if self.age < 0.0:
			direct = False

		sdir = secdir.SecDir(self.chart, age, direct, self.soltime)
		y, m, d, hour, minute, second = sdir.compute()

		if self._is_outside_ephem(y, m, d):
			self.age = prev_age
			self.daytxt.SetValue(self._format_age_value(self.age))
			wx.MessageBox(mtexts.txts['RangeError2'], mtexts.txts['Error'],
						  wx.OK | wx.ICON_EXCLAMATION, self)
			return

		time = chart.Time(y, m, d, hour, minute, second, False, self.chart.time.cal, self.zt, self.chart.time.plus, self.zh, self.zm, False, self.chart.place, False)
		chrt = chart.Chart(self.chart.name, self.chart.male, time, self.chart.place, chart.Chart.TRANSIT, '', self.options, False)

		if self._on_step is not None:
			self._on_step(chrt, self.caption)
		else:
			self.parent.change(chrt, self.caption)


	def onIncr(self, event):
		self._step_to_symbolic_age(float(self.age) + self.DAY_STEP_DAYS)


	def onDecr(self, event):
		self._step_to_symbolic_age(float(self.age) - self.DAY_STEP_DAYS)


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

import wx
import chart
import chartalerts
import moonphasejump
import soundfx
import util


class ChartSession(object):
	CHART = 0
	COMPOUND = 1
	POSITIONS = 2
	SQUARE = 3

	UP_KEYS = tuple(k for k in (getattr(wx, 'WXK_UP', None), getattr(wx, 'WXK_NUMPAD_UP', None), 315) if k is not None)
	DOWN_KEYS = tuple(k for k in (getattr(wx, 'WXK_DOWN', None), getattr(wx, 'WXK_NUMPAD_DOWN', None), 317) if k is not None)
	LEFT_KEYS = tuple(k for k in (getattr(wx, 'WXK_LEFT', None), getattr(wx, 'WXK_NUMPAD_LEFT', None), 314) if k is not None)
	RIGHT_KEYS = tuple(k for k in (getattr(wx, 'WXK_RIGHT', None), getattr(wx, 'WXK_NUMPAD_RIGHT', None), 316) if k is not None)

	def __init__(self, chrt, radix, options, view_mode=0,
				 navigation_units=None, navigation_title_label=None,
				 stepper=None, on_change=None, display_datetime=None):
		self.chart = chrt
		self._initial_chart = chrt
		self.display_datetime = display_datetime if display_datetime is not None else self._chart_display_datetime(chrt)
		self._initial_display_datetime = self.display_datetime
		self.radix = radix
		self.options = options
		self.view_mode = view_mode
		self.navigation_units = navigation_units
		self.navigation_title_label = navigation_title_label
		self._stepper = stepper
		self._on_change = on_change
		self._active_exact_asc_hits = self._current_exact_asc_hits()
		self._last_tab_toggle = 0.0

	def _normalized_nav_key(self, keycode):
		if keycode in self.UP_KEYS:
			return wx.WXK_UP
		if keycode in self.DOWN_KEYS:
			return wx.WXK_DOWN
		if keycode in self.LEFT_KEYS:
			return wx.WXK_LEFT
		if keycode in self.RIGHT_KEYS:
			return wx.WXK_RIGHT
		return keycode

	def _get_navigation_unit(self, shift_down=False, alt_down=False):
		if not self.navigation_units:
			return None
		if alt_down:
			return self.navigation_units[2]
		if shift_down:
			return self.navigation_units[1]
		return self.navigation_units[0]

	def _navigate_intrinsically(self, keycode, shift_down=False, alt_down=False):
		keycode = self._normalized_nav_key(keycode)
		if keycode in (wx.WXK_UP, wx.WXK_DOWN):
			if tuple(self.navigation_units or ()) != ('day', 'hour', 'minute'):
				return False
			if shift_down and not alt_down:
				delta = 1 if keycode == wx.WXK_UP else -1
				return self.navigate_to_classical_phase(delta)
			delta = 1 if keycode == wx.WXK_UP else -1
			return self.navigate_relative('week', delta)
		if keycode not in (wx.WXK_LEFT, wx.WXK_RIGHT):
			return False
		unit = self._get_navigation_unit(shift_down=shift_down, alt_down=alt_down)
		if unit is None:
			return False
		delta = -1 if keycode == wx.WXK_LEFT else 1
		return self.navigate_relative(unit, delta)

	def _forward_stepper_arrow(self, keycode, shift_down=False, alt_down=False, control_down=False, cmd_down=False):
		stepper = self._stepper
		if stepper is None:
			return False
		try:
			if hasattr(stepper, 'handle_navigation_key') and stepper.handle_navigation_key(
				keycode, shift_down=shift_down, alt_down=alt_down,
				control_down=control_down, cmd_down=cmd_down,
			):
				return True
			if keycode == wx.WXK_LEFT and hasattr(stepper, 'step_backward'):
				stepper.step_backward()
				return True
			if keycode == wx.WXK_RIGHT and hasattr(stepper, 'step_forward'):
				stepper.step_forward()
				return True
		except Exception:
			return False
		return False

	def navigate_relative(self, unit, delta):
		if unit not in ('day', 'hour', 'minute', 'week'):
			return False

		t = self.chart.time
		y = getattr(t, 'origyear', t.year)
		m = getattr(t, 'origmonth', t.month)
		d = getattr(t, 'origday', t.day)
		h = t.hour
		mi = t.minute
		s = t.second

		if unit == 'day':
			if delta > 0:
				y, m, d = util.incrDay(y, m, d)
			else:
				y, m, d = util.decrDay(y, m, d)
		elif unit == 'week':
			for _ in range(abs(int(delta)) * 7):
				if delta > 0:
					y, m, d = util.incrDay(y, m, d)
				else:
					y, m, d = util.decrDay(y, m, d)
		elif unit == 'hour':
			if delta > 0:
				y, m, d, h = util.addHour(y, m, d, h)
			else:
				y, m, d, h = util.subtractHour(y, m, d, h)
		elif unit == 'minute':
			if delta > 0:
				y, m, d, h, mi = util.addMins(y, m, d, h, mi, 1)
			else:
				y, m, d, h, mi = util.subtractMins(y, m, d, h, mi, 1)

		newtime = chart.Time(
			y, m, d, h, mi, s,
			t.bc, t.cal, t.zt, t.plus, t.zh, t.zm, t.daylightsaving,
			self.chart.place, False
		)
		newchart = chart.Chart(
			self.chart.name, self.chart.male, newtime, self.chart.place,
			self.chart.htype, '', self.options, False
		)
		self.change_chart(newchart)
		return True

	def navigate_to_classical_phase(self, delta):
		try:
			newtime = moonphasejump.jump_to_classical_phase(self.chart.time, self.chart.place, delta)
		except Exception:
			return False
		if newtime is None:
			return False
		newchart = chart.Chart(
			self.chart.name, self.chart.male, newtime, self.chart.place,
			self.chart.htype, '', self.options, False
		)
		self.change_chart(newchart)
		return True

	def reset_to_initial_chart(self):
		if self._initial_chart is None:
			return False
		if self.chart is not self._initial_chart:
			self.change_chart(self._initial_chart, display_datetime=self._initial_display_datetime)
		return True

	def toggleComparisonView(self):
		if self.view_mode == self.COMPOUND:
			self.view_mode = self.CHART
		elif self.view_mode == self.CHART:
			self.view_mode = self.COMPOUND
		self._fire_change()

	def _chart_display_datetime(self, chrt):
		if chrt is None or getattr(chrt, 'time', None) is None:
			return None
		t = chrt.time
		return (
			getattr(t, 'origyear', t.year),
			getattr(t, 'origmonth', t.month),
			getattr(t, 'origday', t.day),
			t.hour,
			t.minute,
			t.second,
		)

	def change_chart(self, chrt, display_datetime=None):
		self.chart = chrt
		self.display_datetime = display_datetime if display_datetime is not None else self._chart_display_datetime(chrt)
		self._handle_chart_alerts()
		self._fire_change()

	def _current_exact_asc_hits(self):
		if self.radix is None or self.chart is None:
			return ()
		if self.chart is self.radix:
			return ()
		return chartalerts.selected_exact_hits(self.radix, self.chart, self.options)

	def _handle_chart_alerts(self):
		current_hits = self._current_exact_asc_hits()
		new_hits = tuple(hit for hit in current_hits if hit not in self._active_exact_asc_hits)
		if new_hits:
			soundfx.play_sound()
		self._active_exact_asc_hits = current_hits

	def _fire_change(self):
		if self._on_change is not None:
			self._on_change(self)

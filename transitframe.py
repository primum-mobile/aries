# -*- coding: utf-8 -*-
import wx
import astrology
import chart
import chartalerts
import moonphasejump
import positionswnd
import positionswnd2
import soundfx
import transitwnd
import squarechartwnd
import primdirs
import placidiansapd
import placidianutppd
import regiomontanpd
import campanianpd
import primdirsrevlistframe
import wx.lib.newevent
import _thread
import time
import mtexts
import common
import util
import keyboard_layers
import wxcompat

(PDReadyEvent, EVT_PDREADY) = wx.lib.newevent.NewEvent()
pdlock = _thread.allocate_lock()


class TransitFrame(wx.Frame):
	CHART = 0
	COMPOUND = 1
	POSITIONS = 2
	SQUARE = 3
	UP_KEYS = tuple(k for k in (getattr(wx, 'WXK_UP', None), getattr(wx, 'WXK_NUMPAD_UP', None), 315) if k is not None)
	DOWN_KEYS = tuple(k for k in (getattr(wx, 'WXK_DOWN', None), getattr(wx, 'WXK_NUMPAD_DOWN', None), 317) if k is not None)
	LEFT_KEYS = tuple(k for k in (getattr(wx, 'WXK_LEFT', None), getattr(wx, 'WXK_NUMPAD_LEFT', None), 314) if k is not None)
	RIGHT_KEYS = tuple(k for k in (getattr(wx, 'WXK_RIGHT', None), getattr(wx, 'WXK_NUMPAD_RIGHT', None), 316) if k is not None)

	def __init__(self, parent, title, chrt, radix, options, sel=0):
		wx.Frame.__init__(self, parent, -1, title, wx.DefaultPosition, wx.Size(640, 400))
		wxcompat.apply_frame_screen_size(self, 0.80, (640, 400), square=True)

		self.chart = chrt
		self._initial_chart = chrt
		self.radix = radix
		self.options = options
		self.parent = parent
		self.title = title
		self._stepper = None
		self.navigation_units = None
		self.navigation_title_label = None
		self._active_exact_asc_hits = ()

		self.pmenu = wx.Menu()
		self.ID_Selection = wx.NewId()
		self.ID_PrimaryDirections = wx.NewId()
		self.ID_SaveAsBitmap = wx.NewId()
		self.ID_BlackAndWhite = wx.NewId()

		self.ID_Chart = wx.NewId()
		self.ID_Comparison = wx.NewId()
		self.ID_Positions = wx.NewId()
		self.ID_Square = wx.NewId()
		self.ID_CloseWindow = wx.NewId()
		self.ID_ARROW_YEAR_PREV = wx.NewId()
		self.ID_ARROW_YEAR_NEXT = wx.NewId()
		self.ID_ARROW_MONTH_PREV = wx.NewId()
		self.ID_ARROW_MONTH_NEXT = wx.NewId()
		self.ID_ARROW_DAY_PREV = wx.NewId()
		self.ID_ARROW_DAY_NEXT = wx.NewId()
		self.ID_ARROW_WEEK_PREV = wx.NewId()
		self.ID_ARROW_WEEK_NEXT = wx.NewId()
		self.ID_ARROW_SYNODIC_PREV = wx.NewId()
		self.ID_ARROW_SYNODIC_NEXT = wx.NewId()

		self.ID_PDDirect = wx.NewId()
		self.ID_PDConverse = wx.NewId()
		self.ID_PDBoth = wx.NewId()
		self.ID_PDToRadix = wx.NewId()

		self.selmenu = wx.Menu()
		self.chartmenu = self.selmenu.Append(self.ID_Chart, mtexts.txts['Chart'], '', wx.ITEM_RADIO)
		self.compoundmenu = self.selmenu.Append(self.ID_Comparison, mtexts.txts['Comparison'], '', wx.ITEM_RADIO)
		self.positionsmenu = self.selmenu.Append(self.ID_Positions, mtexts.txts['Positions'], '', wx.ITEM_RADIO)
		self.squaremenu = self.selmenu.Append(self.ID_Square, mtexts.txts['Square'], '', wx.ITEM_RADIO)

		self.pmenu.Append(self.ID_Selection, mtexts.txts['Windows'], self.selmenu)

		if self.chart.htype == chart.Chart.SOLAR or self.chart.htype == chart.Chart.LUNAR:
			self.pdselmenu = wx.Menu()
			self.pddirectmenu = self.pdselmenu.Append(self.ID_PDDirect, mtexts.txts['Direct'], '')
			self.pdconversemenu = self.pdselmenu.Append(self.ID_PDConverse, mtexts.txts['Converse'], '')
			self.pdbothmenu = self.pdselmenu.Append(self.ID_PDBoth, mtexts.txts['Both'], '')
			#self.pdtoradix = self.pdselmenu.Append(self.ID_PDToRadix, mtexts.txts['PDToRadix'], '', wx.ITEM_CHECK)
			#self.pdtoradix.Enable(False)
			self.pmenu.Append(self.ID_PrimaryDirections, mtexts.txts['PrimaryDirs'], self.pdselmenu)

		self.pmenu.Append(self.ID_SaveAsBitmap, mtexts.txts['SaveAsBmp'], mtexts.txts['SaveChart'])
		self.mbw = self.pmenu.Append(self.ID_BlackAndWhite, mtexts.txts['BlackAndWhite'], mtexts.txts['ChartBW'], wx.ITEM_CHECK)
		
		self.Bind(wx.EVT_RIGHT_UP, self.onPopupMenu)
		self.Bind(wx.EVT_CONTEXT_MENU, self.onContextMenu)
		self.Bind(wx.EVT_CHAR_HOOK, self.onCharHook)
		self.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		self._last_tab_toggle = 0.0

		self._content_sizer = wx.BoxSizer(wx.VERTICAL)
		self.SetSizer(self._content_sizer)

		self.Bind(wx.EVT_MENU, self.onChart, id=self.ID_Chart)
		self.Bind(wx.EVT_MENU, self.onComparison, id=self.ID_Comparison)
		self.Bind(wx.EVT_MENU, self.onPositions, id=self.ID_Positions)
		self.Bind(wx.EVT_MENU, self.onSquare, id=self.ID_Square)
		self.Bind(wx.EVT_MENU, self.onCloseWindowShortcut, id=self.ID_CloseWindow)
		self.Bind(wx.EVT_MENU, self.onArrowYearPrev, id=self.ID_ARROW_YEAR_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowYearNext, id=self.ID_ARROW_YEAR_NEXT)
		self.Bind(wx.EVT_MENU, self.onArrowMonthPrev, id=self.ID_ARROW_MONTH_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowMonthNext, id=self.ID_ARROW_MONTH_NEXT)
		self.Bind(wx.EVT_MENU, self.onArrowDayPrev, id=self.ID_ARROW_DAY_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowDayNext, id=self.ID_ARROW_DAY_NEXT)
		self.Bind(wx.EVT_MENU, self.onArrowWeekPrev, id=self.ID_ARROW_WEEK_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowWeekNext, id=self.ID_ARROW_WEEK_NEXT)
		self.Bind(wx.EVT_MENU, self.onArrowSynodicPrev, id=self.ID_ARROW_SYNODIC_PREV)
		self.Bind(wx.EVT_MENU, self.onArrowSynodicNext, id=self.ID_ARROW_SYNODIC_NEXT)
		if self.chart.htype == chart.Chart.SOLAR or self.chart.htype == chart.Chart.LUNAR:
			self.Bind(wx.EVT_MENU, self.onPDDirect, id=self.ID_PDDirect)
			self.Bind(wx.EVT_MENU, self.onPDConverse, id=self.ID_PDConverse)
			self.Bind(wx.EVT_MENU, self.onPDBoth, id=self.ID_PDBoth)
			self.Bind(wx.EVT_MENU, self.onPDToRadix, id=self.ID_PDToRadix)
		self.Bind(wx.EVT_MENU, self.onSaveAsBitmap, id=self.ID_SaveAsBitmap)
		self.Bind(wx.EVT_MENU, self.onBlackAndWhite, id=self.ID_BlackAndWhite)

		if self.options.bw:
			self.mbw.Check()

		self.SetAcceleratorTable(wx.AcceleratorTable([
			(wx.ACCEL_CMD, ord('W'), self.ID_CloseWindow),
			(0, wx.WXK_LEFT, self.ID_ARROW_YEAR_PREV),
			(0, wx.WXK_RIGHT, self.ID_ARROW_YEAR_NEXT),
			(wx.ACCEL_SHIFT, wx.WXK_LEFT, self.ID_ARROW_MONTH_PREV),
			(wx.ACCEL_SHIFT, wx.WXK_RIGHT, self.ID_ARROW_MONTH_NEXT),
			(wx.ACCEL_ALT, wx.WXK_LEFT, self.ID_ARROW_DAY_PREV),
			(wx.ACCEL_ALT, wx.WXK_RIGHT, self.ID_ARROW_DAY_NEXT),
			(wx.ACCEL_ALT | wx.ACCEL_SHIFT, wx.WXK_LEFT, self.ID_ARROW_DAY_PREV),
			(wx.ACCEL_ALT | wx.ACCEL_SHIFT, wx.WXK_RIGHT, self.ID_ARROW_DAY_NEXT),
			(0, wx.WXK_UP, self.ID_ARROW_WEEK_PREV),
			(0, wx.WXK_DOWN, self.ID_ARROW_WEEK_NEXT),
			(0, getattr(wx, 'WXK_NUMPAD_UP', wx.WXK_UP), self.ID_ARROW_WEEK_PREV),
			(0, getattr(wx, 'WXK_NUMPAD_DOWN', wx.WXK_DOWN), self.ID_ARROW_WEEK_NEXT),
			(wx.ACCEL_SHIFT, wx.WXK_UP, self.ID_ARROW_SYNODIC_PREV),
			(wx.ACCEL_SHIFT, wx.WXK_DOWN, self.ID_ARROW_SYNODIC_NEXT),
			(wx.ACCEL_SHIFT, getattr(wx, 'WXK_NUMPAD_UP', wx.WXK_UP), self.ID_ARROW_SYNODIC_PREV),
			(wx.ACCEL_SHIFT, getattr(wx, 'WXK_NUMPAD_DOWN', wx.WXK_DOWN), self.ID_ARROW_SYNODIC_NEXT),
		]))

		self.selection = sel
		if sel == TransitFrame.CHART:
			self.w = self._set_content_window(
				transitwnd.TransitWnd(self, self.chart, radix, options, parent, False, -1, self.GetClientSize())
			)
			self.chartmenu.Check()
		else:
			self.w = self._set_content_window(
				transitwnd.TransitWnd(self, self.chart, self.radix, self.options, self.parent, True, -1, self.GetClientSize())
			)
			self.compoundmenu.Check()

		self.Bind(EVT_PDREADY, self.OnPDReady)
		self.Bind(wx.EVT_CLOSE, self.OnClose)
		# === status bar: split 2 fields (left datetime, right lon/lat) ===
		self.statusbar = getattr(self, 'statusbar', None) or self.CreateStatusBar(2)
		self.statusbar.SetFieldsCount(2)
		# 반반 폭(비율 지정): 음수면 비율, [-1, -1] = 1:1
		self.statusbar.SetStatusWidths([-1, -1])
		# 상태바 폰트를 메인과 동일하게 맞춤
		app = wx.GetApp()
		top = app.GetTopWindow() if app else None
		main_sb = top.GetStatusBar() if top else None
		if main_sb:
			self.statusbar.SetFont(main_sb.GetFont())
			self.SendSizeEvent()

		self._update_status_time_place()
		self._active_exact_asc_hits = self._current_exact_asc_hits()

	def _set_content_window(self, window):
		if hasattr(self, "w") and self.w:
			try:
				self._content_sizer.Detach(self.w)
			except Exception:
				pass
			try:
				self.w.Destroy()
			except Exception:
				pass

		self.w = window
		try:
			self.w.Bind(wx.EVT_KEY_DOWN, self.onKeyDown)
		except Exception:
			pass
		try:
			self.w.Bind(wx.EVT_CHAR_HOOK, self.onCharHook)
		except Exception:
			pass
		self._content_sizer.Add(self.w, 1, wx.EXPAND)
		self.Layout()
		return self.w

	def _showPopupMenuAtScreenPos(self, screen_pos=None):
		try:
			self.Raise()
		except Exception:
			pass
		try:
			self.SetFocus()
		except Exception:
			pass

		pos = wx.DefaultPosition
		try:
			if screen_pos is None or screen_pos == wx.DefaultPosition or getattr(screen_pos, 'x', -1) < 0 or getattr(screen_pos, 'y', -1) < 0:
				screen_pos = wx.GetMousePosition()
			pos = self.ScreenToClient(screen_pos)
		except Exception:
			pass

		self.PopupMenu(self.pmenu, pos)

	def onPopupMenu(self, event):
		screen_pos = None
		try:
			screen_pos = self.ClientToScreen(event.GetPosition())
		except Exception:
			pass
		self._showPopupMenuAtScreenPos(screen_pos)

	def onContextMenu(self, event):
		screen_pos = None
		try:
			screen_pos = event.GetPosition()
		except Exception:
			pass
		self._showPopupMenuAtScreenPos(screen_pos)

	def toggleComparisonView(self):
		if self.selection == TransitFrame.COMPOUND:
			self.onChart(None)
		elif self.selection == TransitFrame.CHART:
			self.onComparison(None)

	def _forward_stepper_arrow(self, keycode, shift_down=False, alt_down=False, control_down=False, cmd_down=False):
		stepper = getattr(self, "_stepper", None)
		if stepper is None:
			return False

		try:
			if hasattr(stepper, "handle_navigation_key") and stepper.handle_navigation_key(
				keycode,
				shift_down=shift_down,
				alt_down=alt_down,
				control_down=control_down,
				cmd_down=cmd_down,
			):
				return True
			if keycode == wx.WXK_LEFT and hasattr(stepper, "step_backward"):
				stepper.step_backward()
				return True
			if keycode == wx.WXK_RIGHT and hasattr(stepper, "step_forward"):
				stepper.step_forward()
				return True
		except Exception:
			return False

		return False

	def _get_navigation_unit(self, shift_down=False, alt_down=False):
		if not self.navigation_units:
			return None
		if alt_down:
			return self.navigation_units[2]
		if shift_down:
			return self.navigation_units[1]
		return self.navigation_units[0]

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
		self._update_navigation_title()
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
		self._update_navigation_title()
		return True

	def reset_to_initial_chart(self):
		if self._initial_chart is None:
			return False
		if self.chart is not self._initial_chart:
			self.change_chart(self._initial_chart)
			self._update_navigation_title()
		return True

	def _update_navigation_title(self):
		if not self.navigation_title_label:
			return
		t = self.chart.time
		try:
			base_title = self.parent.title
			old_type = mtexts.typeList[self.radix.htype]
		except Exception:
			base_title = self.title
			old_type = self.navigation_title_label

		new_title = base_title.replace(
			old_type,
			self.navigation_title_label+' ('+str(t.origyear)+'.'+common.common.months[t.origmonth-1]+'.'+str(t.origday)+' '+str(t.hour)+':'+str(t.minute).zfill(2)+':'+str(t.second).zfill(2)+')'
		)
		self.title = new_title
		self.SetTitle(new_title)

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

	def onArrowYearPrev(self, event):
		if self._navigate_intrinsically(wx.WXK_LEFT):
			return
		self._forward_stepper_arrow(wx.WXK_LEFT)

	def onArrowYearNext(self, event):
		if self._navigate_intrinsically(wx.WXK_RIGHT):
			return
		self._forward_stepper_arrow(wx.WXK_RIGHT)

	def onArrowMonthPrev(self, event):
		if self._navigate_intrinsically(wx.WXK_LEFT, shift_down=True):
			return
		self._forward_stepper_arrow(wx.WXK_LEFT, shift_down=True)

	def onArrowMonthNext(self, event):
		if self._navigate_intrinsically(wx.WXK_RIGHT, shift_down=True):
			return
		self._forward_stepper_arrow(wx.WXK_RIGHT, shift_down=True)

	def onArrowDayPrev(self, event):
		if self._navigate_intrinsically(wx.WXK_LEFT, shift_down=True, alt_down=True):
			return
		self._forward_stepper_arrow(wx.WXK_LEFT, shift_down=True, alt_down=True)

	def onArrowDayNext(self, event):
		if self._navigate_intrinsically(wx.WXK_RIGHT, shift_down=True, alt_down=True):
			return
		self._forward_stepper_arrow(wx.WXK_RIGHT, shift_down=True, alt_down=True)

	def onArrowWeekPrev(self, event):
		if self._navigate_intrinsically(wx.WXK_UP):
			return
		return

	def onArrowWeekNext(self, event):
		if self._navigate_intrinsically(wx.WXK_DOWN):
			return
		return

	def onArrowSynodicPrev(self, event):
		if self._navigate_intrinsically(wx.WXK_UP, shift_down=True):
			return
		return

	def onArrowSynodicNext(self, event):
		if self._navigate_intrinsically(wx.WXK_DOWN, shift_down=True):
			return
		return

	def onCloseWindowShortcut(self, event):
		self.Close()

	def onCharHook(self, event):
		if keyboard_layers.handle_transit_key_event(self, event):
			return

		event.Skip()

	def onKeyDown(self, event):
		if keyboard_layers.handle_transit_key_event(self, event):
			return

		event.Skip()


	def onChart(self, event):
		if self.selection != TransitFrame.CHART:
			self.selection = TransitFrame.CHART
			self._set_content_window(
				transitwnd.TransitWnd(self, self.chart, self.radix, self.options, self.parent, False, -1, self.GetClientSize())
			)
			wx.CallAfter(self.w.SetFocus)
			self._update_status_time_place()

	def onComparison(self, event):
		if self.selection != TransitFrame.COMPOUND:
			self.selection = TransitFrame.COMPOUND
			self._set_content_window(
				transitwnd.TransitWnd(self, self.chart, self.radix, self.options, self.parent, True, -1, self.GetClientSize())
			)
			wx.CallAfter(self.w.SetFocus)
			self._update_status_time_place()

	def onPositions(self, event):
		if self.selection != TransitFrame.POSITIONS:
			self.selection = TransitFrame.POSITIONS
			if wx.Platform == '__WXMSW__':
				self._set_content_window(
					positionswnd2.PositionsWnd2(self, self.chart, self.options, self.parent, -1, self.GetClientSize())
				)
				self.w.Refresh()
			else:
				self._set_content_window(
					positionswnd.PositionsWnd(self, self.chart, self.options, self.parent, -1, self.GetClientSize())
				)
				self._update_status_time_place()

	def onSquare(self, event):
		if self.selection != TransitFrame.SQUARE:
			self.selection = TransitFrame.SQUARE
			self._set_content_window(
				squarechartwnd.SquareChartWnd(self, self.chart, self.options, self.parent, -1, self.GetClientSize())
			)
			self._update_status_time_place()

	def change_chart(self, chrt):
		self.chart = chrt

		if self.selection == TransitFrame.CHART:
			self._set_content_window(
				transitwnd.TransitWnd(self, self.chart, self.radix, self.options, self.parent, False, -1, self.GetClientSize())
			)
		elif self.selection == TransitFrame.COMPOUND:
			self._set_content_window(
				transitwnd.TransitWnd(self, self.chart, self.radix, self.options, self.parent, True, -1, self.GetClientSize())
			)
		elif self.selection == TransitFrame.POSITIONS:
			if wx.Platform == '__WXMSW__':
				self._set_content_window(
					positionswnd2.PositionsWnd2(self, self.chart, self.options, self.parent, -1, self.GetClientSize())
				)
			else:
				self._set_content_window(
					positionswnd.PositionsWnd(self, self.chart, self.options, self.parent, -1, self.GetClientSize())
				)
		elif self.selection == TransitFrame.SQUARE:
			self._set_content_window(
				squarechartwnd.SquareChartWnd(self, self.chart, self.options, self.parent, -1, self.GetClientSize())
			)

		try:
			self.w.SetFocus()
		except Exception:
			pass
		self._update_status_time_place()
		self._handle_chart_alerts()

	def _fmt_lonlat(self, p):
		deg = u"\N{DEGREE SIGN}"
		lon_txt = f"{p.deglon}{deg}{str(p.minlon).zfill(2)}' " + ('E' if p.east else 'W')
		lat_txt = f"{p.deglat}{deg}{str(p.minlat).zfill(2)}' " + ('N' if p.north else 'S')
		return lon_txt, lat_txt

	def _update_status_time_place(self):
		try:
			t = self.chart.time
			p = self.chart.place
		except Exception:
			return

		# === 왼쪽: yyyy.month.dd HH:MM:SS + ZN/UT/LC (메인 차트와 동일 양식) ===
		# BC 표시
		signtxt = '-' if getattr(t, 'bc', False) else ''
		# 타임존 라벨(ZN/UT/LC)
		ztxt = mtexts.txts['UT']
		if t.zt == chart.Time.ZONE:
			ztxt = mtexts.txts['ZN']
		elif t.zt == chart.Time.LOCALMEAN or t.zt == chart.Time.LOCALAPPARENT:
			ztxt = mtexts.txts['LC']
		# 월 이름(로케일 반영): common.common.months
		try:
			month_name = common.common.months[t.origmonth-1]
		except Exception:
			# fallback
			month_name = str(t.origmonth).zfill(2)

		left_txt = (
			f"{signtxt}{t.origyear}."
			f"{month_name}."
			f"{str(t.origday).zfill(2)}, "
			f"{str(t.hour).zfill(2)}:{str(t.minute).zfill(2)}:{str(t.second).zfill(2)}"
			f"{ztxt}"
		)

		# === 오른쪽: Long./Lat. (메인 상태바의 포맷 그대로) ===
		deg_symbol = u'°'  
		dir_lon = mtexts.txts['E'] if p.east else mtexts.txts['W']
		dir_lat = mtexts.txts['N'] if p.north else mtexts.txts['S']

		right_txt = (
			f"{mtexts.txts['Long']}: "
			f"{str(p.deglon).zfill(2)}{deg_symbol}{str(p.minlon).zfill(2)}'"
			f"{dir_lon},"
			f" {mtexts.txts['Lat']}: "
			f"{str(p.deglat).zfill(2)}{deg_symbol}{str(p.minlat).zfill(2)}'"
			f"{dir_lat}"
		)

		try:
			(getattr(self, 'statusbar', None) or self.CreateStatusBar(2)).SetStatusText(left_txt, 0)
			self.statusbar.SetStatusText(right_txt, 1)
		except Exception:
			pass

	def onPDDirect(self, event):
		self.onPD(primdirs.PrimDirs.DIRECT)


	def onPDConverse(self, event):
		self.onPD(primdirs.PrimDirs.CONVERSE)

	def onPDBoth(self, event):
		self.onPD(primdirs.PrimDirs.BOTHDC)

	def onPDToRadix(self, event):
		#Because on Windows the EVT_MENU_CLOSE event is not sent in case of accelerator-keys
		if wx.Platform == '__WXMSW__' and not self.splash:
			self.handleStatusBar(True)

#		self.autosave.Check(self.options.autosave)
#		self.options.autosave = self.pdtoradix.IsChecked()


	def onSaveAsBitmap(self, event):
		self.w.onSaveAsBitmap(event)


	def onBlackAndWhite(self, event):
		self.w.onBlackAndWhite(event)


	def onPD(self, direction):
		pdrange = primdirs.PrimDirs.RANGEREV

		keytxt = ''
		if self.options.pdkeydyn:
			keytxt = mtexts.typeListDyn[self.options.pdkeyd]
		else:
			keytxt = mtexts.typeListStat[self.options.pdkeys]

		txt = mtexts.typeListDirs[self.options.primarydir]+'; '+keytxt+'\n'+mtexts.txts['BusyInfo']

		self.progbar = wx.ProgressDialog(mtexts.txts['Calculating'], txt, parent=self, style = wx.PD_CAN_ABORT|wx.PD_APP_MODAL)
		self.progbar.Fit()

		self.pds = None
		self.pdready = False
		self.abort = primdirs.AbortPD()
		thId = _thread.start_new_thread(self.calcPDs, (pdrange, direction, self))

		self.timer = wx.Timer(self)
		self.Bind(wx.EVT_TIMER, self.OnTimer)
		self.timer.Start(500)


	def calcPDs(self, pdrange, direction, win):
		self._pd_effective_options = primdirs.PrimDirs.get_effective_revolution_options(self.chart, self.options)
		pd_options = self._pd_effective_options
		if pd_options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC:
			self.pds = placidiansapd.PlacidianSAPD(self.chart, pd_options, pdrange, direction, self.abort)
		elif pd_options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
			self.pds = placidianutppd.PlacidianUTPPD(self.chart, pd_options, pdrange, direction, self.abort)
		elif pd_options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
			self.pds = regiomontanpd.RegiomontanPD(self.chart, pd_options, pdrange, direction, self.abort)
		else:
			self.pds = campanianpd.CampanianPD(self.chart, pd_options, pdrange, direction, self.abort)

		pdlock.acquire()
		self.pdready = True
		pdlock.release()
		evt = PDReadyEvent()
		wx.PostEvent(win, evt)


	def OnTimer(self, event):
		pdlock.acquire()
		if not self.pdready:
			(keepGoing, skip) = self.progbar.Pulse()

			if not keepGoing:
				self.abort.aborting()
		pdlock.release()


	def OnPDReady(self, event):
		self.timer.Stop()
		del self.timer
		self.progbar.Destroy()
		del self.progbar

		if self.abort.abort:
			self.Refresh()
		else:
			if self.pds != None and len(self.pds.pds) > 0:
				pdw = primdirsrevlistframe.PrimDirsRevListFrame(self, self.parent, self.chart, getattr(self, '_pd_effective_options', self.options), self.pds, self.title.replace(mtexts.typeList[self.chart.htype], mtexts.txts['PrimaryDirs']))

				pdw.Show(True)
			else:
				dlgm = wx.MessageDialog(self, mtexts.txts['NoPDsWithSettings'], mtexts.txts['Information'], wx.OK|wx.ICON_INFORMATION)
				dlgm.ShowModal()
				dlgm.Destroy()#

		if self.pds != None:
			del self.pds

		if hasattr(self, '_pd_effective_options'):
			del self._pd_effective_options

		del self.abort
	def OnClose(self, evt):
		try:
			if hasattr(self, "abort") and self.abort:
				self.abort.aborting()
		except Exception:
			pass
		try:
			if hasattr(self, "timer") and self.timer:
				self.timer.Stop()
				del self.timer
		except Exception:
			pass
		try:
			if hasattr(self, "progbar") and self.progbar:
				self.progbar.Destroy()
				del self.progbar
		except Exception:
			pass
		try:
			self.Destroy()
		finally:
			evt.Skip()

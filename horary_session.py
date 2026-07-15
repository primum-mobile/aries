# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import chart_session

# This module started as the horary session wrapper, but it now also hosts
# other self-anchored intrinsic-stepping session types. DirtyRadixSession
# lives here because it shares the same "chart is its own radix" navigation
# pattern even though it is not horary-specific semantically.


class HorarySession(chart_session.ChartSession):
	"""Thin wrapper over ChartSession for horary / 'Here and Now' charts.

	Uses the chart itself as its own radix so that intrinsic time
	navigation (day / hour / minute / second via arrow keys) works out of the box.
	Subclass this to add horary-specific displays and logic later.
	"""

	def __init__(self, chrt, options, on_change=None, on_step_dirty_change=None, **kw):
		self._on_step_dirty_change = on_step_dirty_change
		self._stepped_dirty = False
		super().__init__(
			chrt,
			radix=chrt,
			options=options,
			view_mode=chart_session.ChartSession.CHART,
			navigation_units=('day', 'hour', 'minute', 'second'),
			on_change=on_change,
			**kw
		)

	def _notify_step_dirty_change(self):
		if callable(self._on_step_dirty_change):
			self._on_step_dirty_change(self._stepped_dirty)

	def change_chart(self, chrt, display_datetime=None, change_reason='normal'):
		# Horary stepping mutates the radix itself so that LOY/term lord
		# (which derive from radix ascendant) follow the timestepped chart.
		self.radix = chrt
		super().change_chart(chrt, display_datetime=display_datetime, change_reason=change_reason)

	def _refresh_step_dirty(self):
		current_dt = tuple(int(v) for v in (self.display_datetime or ()))
		initial_dt = tuple(int(v) for v in (self._initial_display_datetime or ()))
		new_dirty = bool(current_dt and current_dt != initial_dt)
		if new_dirty == self._stepped_dirty:
			return
		self._stepped_dirty = new_dirty
		self._notify_step_dirty_change()

	def navigate_relative(self, unit, delta):
		changed = super().navigate_relative(unit, delta)
		if changed:
			self._refresh_step_dirty()
		return changed

	def navigate_to_classical_phase(self, delta):
		changed = super().navigate_to_classical_phase(delta)
		if changed:
			self._refresh_step_dirty()
		return changed

	def reset_to_initial_chart(self):
		changed = super().reset_to_initial_chart()
		if changed:
			self._refresh_step_dirty()
		return changed

	def mark_saved(self):
		self._initial_chart = self.chart
		self._initial_display_datetime = self.display_datetime
		self._initial_cursor_jd = self.cursor_jd
		self._stepped_dirty = False
		self._notify_step_dirty_change()


class DirtyRadixSession(chart_session.ChartSession):
	"""Intrinsic stepping session for unsaved / dirty radix charts.

	Uses the radix as its own anchor, like HorarySession, but remains a radix
	session semantically so UI title logic can stay on the normal radix path.
	"""

	def __init__(self, chrt, options, on_change=None, on_step_dirty_change=None, **kw):
		self._on_step_dirty_change = on_step_dirty_change
		self._stepped_dirty = False
		super().__init__(
			chrt,
			radix=chrt,
			options=options,
			view_mode=chart_session.ChartSession.CHART,
			navigation_units=('day', 'hour', 'minute', 'second'),
			on_change=on_change,
			**kw
		)

	def _notify_step_dirty_change(self):
		if callable(self._on_step_dirty_change):
			self._on_step_dirty_change(self._stepped_dirty)

	def change_chart(self, chrt, display_datetime=None, change_reason='normal'):
		# Dirty radix stepping mutates the radix itself; it must remain its own
		# anchor so close/save gating and child launch semantics keep treating it
		# as a standalone radix rather than a derived chart.
		self.radix = chrt
		super().change_chart(chrt, display_datetime=display_datetime, change_reason=change_reason)

	def _refresh_step_dirty(self):
		current_dt = tuple(int(v) for v in (self.display_datetime or ()))
		initial_dt = tuple(int(v) for v in (self._initial_display_datetime or ()))
		new_dirty = bool(current_dt and current_dt != initial_dt)
		if new_dirty == self._stepped_dirty:
			return
		self._stepped_dirty = new_dirty
		self._notify_step_dirty_change()

	def navigate_relative(self, unit, delta):
		changed = super().navigate_relative(unit, delta)
		if changed:
			self._refresh_step_dirty()
		return changed

	def navigate_to_classical_phase(self, delta):
		changed = super().navigate_to_classical_phase(delta)
		if changed:
			self._refresh_step_dirty()
		return changed

	def reset_to_initial_chart(self):
		changed = super().reset_to_initial_chart()
		if changed:
			self._refresh_step_dirty()
		return changed

	def mark_saved(self):
		self._initial_chart = self.chart
		self._initial_display_datetime = self.display_datetime
		self._initial_cursor_jd = self.cursor_jd
		self._stepped_dirty = False
		self._notify_step_dirty_change()

import chart_session


class HorarySession(chart_session.ChartSession):
	"""Thin wrapper over ChartSession for horary / 'Here and Now' charts.

	Uses the chart itself as its own radix so that intrinsic time
	navigation (day / hour / minute via arrow keys) works out of the box.
	Subclass this to add horary-specific displays and logic later.
	"""

	def __init__(self, chrt, options, on_change=None, **kw):
		super().__init__(
			chrt,
			radix=chrt,
			options=options,
			view_mode=chart_session.ChartSession.CHART,
			navigation_units=('day', 'hour', 'minute'),
			on_change=on_change,
			**kw
		)

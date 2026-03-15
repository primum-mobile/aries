# -*- coding: utf-8 -*-
import transitframe
import common
import mtexts
import util
import wx
import wxcompat

class ProfectionsFrame(transitframe.TransitFrame):
	def __init__(self, parent, title, chrt, radix, options, display_datetime=None):
		transitframe.TransitFrame.__init__(self, parent, title, chrt, radix, options)
		self.display_datetime = display_datetime
		try:
			self.w.display_datetime = display_datetime
		except Exception:
			pass
		wxcompat.apply_frame_screen_size(self, 0.80, (640, 400), square=True)
		self.Layout()
		self.SendSizeEvent()

	def change(self, chrt, title, y, m, d, t):
		self.chart = chrt
		self.w.chart = chrt
		h, mi, s = util.decToDeg(t)
		self.display_datetime = (y, m, d, h, mi, s)
		self.w.display_datetime = self.display_datetime
		self.w.drawBkg()
		self.w.Refresh()
		self._handle_chart_alerts()

		#Update Caption
		title = title.replace(mtexts.txts['Radix'], mtexts.txts['Profections']+' ('+str(y)+'.'+common.common.months[m-1]+'.'+str(d)+' '+str(h)+':'+str(mi).zfill(2)+':'+str(s).zfill(2)+')')
		self.SetTitle(title)

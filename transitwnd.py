# -*- coding: utf-8 -*-
import wx
import os
import chart
import graphchart
import graphchart2
import mtexts
import fixstars
import arabicparts
import syzygy

class TransitWnd(wx.Window):
	def __init__(self, parent, chrt, radix, options, mainfr, compound = False, id = -1, size = wx.DefaultSize):
		wx.Window.__init__(self, parent, id, wx.DefaultPosition, size=size)

		self.parent = parent
		self.chart = chrt
		self.radix = radix
		self.display_datetime = getattr(parent, 'display_datetime', None)
		# === ensure Arabic Parts / antiscia / fixstars for transit/revolution/election ===
		try:
			C = self.chart

			# Arabic Parts ensure for non-radix charts (revolutions/elections/transits)
			if not hasattr(self.chart, 'parts') or getattr(self.chart, 'parts') is None:
				try:
					C = self.chart
					# syzygy가 없으면 먼저 확보
					if not hasattr(C, 'syzygy') or C.syzygy is None:
						C.syzygy = syzygy.Syzygy(C)

					# ArabicParts 정식 생성자 호출
					C.parts = arabicparts.ArabicParts(
						C.options.arabicparts,
						C.houses.ascmc,
						C.planets,
						C.houses,
						C.houses.cusps,
						C.fortune,
						C.syzygy,
						C.options,
						0.0,
						C.male
					)
				except Exception:
					# 실패해도 크래시는 막고, 그리기 단계에서 자연스럽게 skip
					self.chart.parts = None

			# 2) Antiscia(antis/contra/dodec): 없으면 계산
			if not getattr(C, 'antiscia', None) and hasattr(C, 'calcAntiscia'):
				C.calcAntiscia()

			# 3) Fixed stars 본체: 없으면 생성 (이미 뜬다 했으니 유지)
			if not getattr(C, 'fixstars', None) or not getattr(getattr(C, 'fixstars', None), 'data', None):
				import fixstars
				C.fixstars = fixstars.FixStars(C.time.jd, 0, C.options.fixstars, C.obl[0])

			# 4) Fixed stars aspect matrices: 없으면 계산
			if not getattr(C, 'fsaspmatrix', None) and hasattr(C, 'calcFixStarAspMatrix'):
				C.calcFixStarAspMatrix()
		except Exception:
			pass
		# === end ensure block ===

		self.options = options
		self.mainfr = mainfr
		self.compound = compound

		self.bw = self.options.bw
		self.buffer = wx.Bitmap(1, 1)

		self.SetMinSize((200,200))

		self.parent.mbw.Check(self.bw)

		self.SetBackgroundColour(self.options.clrbackground)

		self._pending_draw = False
		# Defer initial rendering until the window has a non-trivial client size.
		self.drawBkg()

		self.Bind(wx.EVT_RIGHT_UP, self.onPopupMenu)
		self.Bind(wx.EVT_CONTEXT_MENU, self.onContextMenu)

		self.Bind(wx.EVT_PAINT, self.OnPaint)
		self.Bind(wx.EVT_SIZE, self.onSize)
#		self.Refresh()


	def drawBkg(self):
		try:
			w, h = self.GetClientSize().Get()
		except Exception:
			try:
				sz = self.GetClientSize()
				w, h = int(getattr(sz, "x", 0)), int(getattr(sz, "y", 0))
			except Exception:
				w, h = 0, 0

		if w <= 1 or h <= 1:
			# Avoid crashes from 0-sized bitmaps/fonts; retry after layout.
			if not getattr(self, "_pending_draw", False):
				self._pending_draw = True
				try:
					wx.CallAfter(self.drawBkg)
				except Exception:
					pass
			return
		self._pending_draw = False

		# ensure Arabic Parts / antiscia / fixstars for current chart (handles steppers)
		try:
			C = self.chart

			if (not hasattr(C, 'parts')) or (getattr(C, 'parts') is None):
				try:
					if (not hasattr(C, 'syzygy')) or (C.syzygy is None):
						C.syzygy = syzygy.Syzygy(C)
					C.parts = arabicparts.ArabicParts(
						C.options.arabicparts,
						C.houses.ascmc,
						C.planets,
						C.houses,
						C.houses.cusps,
						C.fortune,
						C.syzygy,
						C.options,
						0.0,
						C.male
					)
				except Exception:
					C.parts = None

			if (not getattr(C, 'antiscia', None)) and hasattr(C, 'calcAntiscia'):
				C.calcAntiscia()

			if (not getattr(C, 'fixstars', None)) or (not getattr(getattr(C, 'fixstars', None), 'data', None)):
				import fixstars
				C.fixstars = fixstars.FixStars(C.time.jd, 0, C.options.fixstars, C.obl[0])

			if (not getattr(C, 'fsaspmatrix', None)) and hasattr(C, 'calcFixStarAspMatrix'):
				C.calcFixStarAspMatrix()
		except Exception:
			pass

		gchart = None
		if self.compound:
			if self.options.theme == 0:
				gchart = graphchart.GraphChart(self.radix, self.GetClientSize(), self.options, self.bw, False, self.chart)
			else:
				gchart = graphchart2.GraphChart2(self.radix, self.GetClientSize(), self.options, self.bw, False, self.chart)
		else:
			if self.options.theme == 0:
				gchart = graphchart.GraphChart(self.chart, self.GetClientSize(), self.options, self.bw, False, None)
			else:
				gchart = graphchart2.GraphChart2(self.chart, self.GetClientSize(), self.options, self.bw, False, None)
		try:
			gchart.radix = self.radix
		except Exception:
			pass
		try:
			gchart.display_datetime = getattr(self, 'display_datetime', None)
		except Exception:
			pass

		buffer = gchart.drawChart()
		if buffer is not None:
			self.buffer = buffer
		self.Refresh()#


	def OnPaint(self, event):
		if not getattr(self, 'buffer', None):
			return
		dc = wx.BufferedPaintDC(self, self.buffer, wx.BUFFER_VIRTUAL_AREA)


	def onPopupMenu(self, event):
		try:
			self.parent.Raise()
		except Exception:
			pass
		try:
			self.SetFocus()
		except Exception:
			pass
		try:
			screen_pos = self.ClientToScreen(event.GetPosition())
		except Exception:
			screen_pos = None
		self.parent._showPopupMenuAtScreenPos(screen_pos)

	def onContextMenu(self, event):
		try:
			self.parent.Raise()
		except Exception:
			pass
		try:
			self.SetFocus()
		except Exception:
			pass
		screen_pos = None
		try:
			screen_pos = event.GetPosition()
		except Exception:
			pass
		self.parent._showPopupMenuAtScreenPos(screen_pos)


	def onSaveAsBitmap(self, event):
		name = self.chart.name+(mtexts.typeList[self.chart.htype][0:3]).capitalize()
		dlg = wx.FileDialog(self, mtexts.txts['SaveAsBmp'], '', name, mtexts.txts['BMPFiles'], wx.FD_SAVE)
		if os.path.isdir(self.mainfr.fpathimgs):
			dlg.SetDirectory(self.mainfr.fpathimgs)
		else:
			dlg.SetDirectory(u'.')

		if (dlg.ShowModal() == wx.ID_OK):
			dpath = dlg.GetDirectory()
			fpath = dlg.GetPath()
			if (not fpath.endswith(u'.bmp')):
				fpath+=u'.bmp'
			#Check if fpath already exists!?
			if (os.path.isfile(fpath)):
				dlgm = wx.MessageDialog(self, mtexts.txts['FileExists'], mtexts.txts['Message'], wx.YES_NO|wx.YES_DEFAULT|wx.ICON_QUESTION)
				if (dlgm.ShowModal() == wx.ID_NO):
					dlgm.Destroy()
					dlg.Destroy()
					return
				dlgm.Destroy()

			self.mainfr.fpathimgs = dpath
			self.buffer.SaveFile(fpath, wx.BITMAP_TYPE_BMP)

		dlg.Destroy()


	def onBlackAndWhite(self, event):
		if self.bw != event.IsChecked():
			self.bw = event.IsChecked()
			self.drawBkg()
			self.Refresh()


	def onSize(self, event):
		self.drawBkg()

import wx
import os
import chart
import mundanechart
import mtexts


class MundaneWnd(wx.Window):
	def __init__(self, parent, mainfr, opts, chrt, radix, id = -1, size = wx.DefaultSize):
		wx.Window.__init__(self, parent, id, wx.DefaultPosition, size=size)

		self.parent = parent
		self.mainfr = mainfr
		self.options = opts
		self.chart = chrt
		self.radix = radix

		self.bw = self.options.bw

		self.SetMinSize((200,200))

		self.parent.mbw.Check(self.bw)

		self.SetBackgroundColour(self.options.clrbackground)

		self.drawBkg()

		self.Bind(wx.EVT_RIGHT_UP, self.onPopupMenu)

		self.Bind(wx.EVT_PAINT, self.OnPaint)
		self.Bind(wx.EVT_SIZE, self.onSize)
#		self.Refresh()


	def drawBkg(self):
		size = self.GetClientSize()
		try:
			w, h = int(size.GetWidth()), int(size.GetHeight())
		except Exception:
			w, h = int(size[0]), int(size[1])

		# During window creation, GetClientSize() can briefly be (0, 0) on macOS.
		# Avoid creating charts/fonts with zero sizes; EVT_SIZE will redraw shortly.
		if w < 2 or h < 2:
			w = max(1, w)
			h = max(1, h)
			self.buffer = wx.Bitmap(w, h)
			dc = wx.MemoryDC(self.buffer)
			bkg = (255, 255, 255) if self.bw else self.options.clrbackground
			dc.SetBackground(wx.Brush(bkg))
			dc.Clear()
			dc.SelectObject(wx.NullBitmap)
			return

		if self.radix != None:
			gchart = mundanechart.MundaneChart(self.radix, (w, h), self.options, self.bw, False, self.chart)
		else:
			gchart = mundanechart.MundaneChart(self.chart, (w, h), self.options, self.bw, False, self.radix)


		self.buffer = gchart.drawChart()
		self.Refresh()#


	def OnPaint(self, event):
		dc = wx.BufferedPaintDC(self, self.buffer, wx.BUFFER_VIRTUAL_AREA)


	def onPopupMenu(self, event):
		self.parent.onPopupMenu(event)


	def onSaveAsBitmap(self, event):
		name = self.chart.name+mtexts.txts['MunAbbr']
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



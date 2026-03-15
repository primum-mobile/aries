import wx
import squarechartwnd
import mtexts
import wxcompat
import windowbehavior


class SquareChartFrame(wx.Frame):
	def __init__(self, parent, title, chrt, opts):
		wx.Frame.__init__(self, parent, -1, title, wx.DefaultPosition, wx.Size(640, 400))
		wxcompat.apply_frame_screen_size(self, 0.80, (640, 400), square=True)

		self.chart = chrt
		self.options = opts
		self.parent = parent

		self.pmenu = wx.Menu()
		self.ID_SaveAsBitmap = wx.NewId()
		self.ID_BlackAndWhite = wx.NewId()

		self.pmenu.Append(self.ID_SaveAsBitmap, mtexts.txts['SaveAsBmp'], mtexts.txts['SaveChart'])
		self.mbw = self.pmenu.Append(self.ID_BlackAndWhite, mtexts.txts['BlackAndWhite'], mtexts.txts['ChartBW'], wx.ITEM_CHECK)
		
		self.w = squarechartwnd.SquareChartWnd(self, self.chart, opts, parent)

		self.Bind(wx.EVT_RIGHT_UP, self.onPopupMenu)
		self.Bind(wx.EVT_CONTEXT_MENU, self.onPopupMenu)

		self.Bind(wx.EVT_MENU, self.onSaveAsBitmap, id=self.ID_SaveAsBitmap)
		self.Bind(wx.EVT_MENU, self.onBlackAndWhite, id=self.ID_BlackAndWhite)

		if self.options.bw:
			self.mbw.Check()


	def onPopupMenu(self, event):
		windowbehavior.popup_menu(self, self.pmenu, event)


	def onSaveAsBitmap(self, event):
		self.w.onSaveAsBitmap(event)


	def onBlackAndWhite(self, event):
		self.w.onBlackAndWhite(event)




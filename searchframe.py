# -*- coding: utf-8 -*-

import wx
import mtexts
import searchwnd


class SearchFrame(wx.Frame):
	def __init__(self, parent, title, chrt, options):
		frame_title = '%s - %s' % (title, mtexts.txts.get('Search', 'Search'))
		wx.Frame.__init__(self, parent, -1, frame_title, wx.DefaultPosition, wx.Size(1240, 760))

		self.searchwnd = searchwnd.SearchWnd(self, chrt, options, parent)
		sizer = wx.BoxSizer(wx.VERTICAL)
		sizer.Add(self.searchwnd, 1, wx.EXPAND)
		self.SetSizer(sizer)
		self.SetMinSize((900, 620))
		self.Layout()
		self.CentreOnParent()

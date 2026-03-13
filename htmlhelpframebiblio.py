import webbrowser

import wx


class HtmlHelpFrameBiblio(wx.Frame):
	"""
	Legacy helper used in some Morinus forks to open external bibliography pages.

	This module was corrupted in this workspace (non-Python content), so it has
	been replaced with a minimal, valid implementation to keep imports/builds
	working on modern Python.
	"""

	def __init__(self, parent, id, title, fname):
		super().__init__(parent, id, title, wx.DefaultPosition, wx.Size(640, 400))
		# Best-effort: open the site's books/bibliography section.
		webbrowser.open("http://www.campus-astrologia.es/libros/", new=2)
		self.Destroy()


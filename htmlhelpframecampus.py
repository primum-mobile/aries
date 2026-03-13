import webbrowser

import wx


class HtmlHelpFrameCampus(wx.Frame):
	"""
	Legacy helper used in some Morinus forks to open external learning resources.

	This module was corrupted in this workspace (non-Python content), so it has
	been replaced with a minimal, valid implementation to keep imports/builds
	working on modern Python.
	"""

	_URLS = {
		"Campus": "http://www.campus-astrologia.es/",
		"Libros": "http://www.campus-astrologia.es/libros/",
		"Aprende": "http://www.campus-astrologia.es/category/articulos/",
	}

	def __init__(self, parent, id, title, fname):
		super().__init__(parent, id, title, wx.DefaultPosition, wx.Size(640, 400))
		url = self._URLS.get(str(fname), None)
		if url:
			webbrowser.open(url, new=2)
		self.Destroy()


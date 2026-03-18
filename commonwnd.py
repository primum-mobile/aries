# -*- coding: utf-8 -*-

import os
import wx
import mtexts
import windowbehavior
from PIL import Image as PILImage
from PIL import ImageDraw as PILImageDraw
import wxcompat


class CommonWnd(wx.ScrolledWindow):
    SCROLL_RATE = 20
    BORDER = 20

    def __init__(self, parent, chrt, options, id = -1, size = wx.DefaultSize):
        wx.ScrolledWindow.__init__(self, parent, id, (0, 0), size=size, style=wx.SUNKEN_BORDER)

        self.parent = parent
        self.chart = chrt
        self.options = options
        self.bw = self.options.bw
        self.buffer = wx.Bitmap(1, 1)

        self.SetBackgroundColour(self.options.clrbackground)

        self.SetScrollRate(CommonWnd.SCROLL_RATE, CommonWnd.SCROLL_RATE)

        self.pmenu = wx.Menu()
        self.ID_SaveAsBitmap = wx.NewId()
        self.ID_BlackAndWhite = wx.NewId()
        self.pmenu.Append(self.ID_SaveAsBitmap, mtexts.txts['SaveAsBmp'], mtexts.txts['SaveTable'])
        mbw = self.pmenu.Append(self.ID_BlackAndWhite, mtexts.txts['BlackAndWhite'], mtexts.txts['TableBW'], wx.ITEM_CHECK)
        
        self.Bind(wx.EVT_PAINT, self.OnPaint)
        self.Bind(wx.EVT_RIGHT_UP, self.onPopupMenu)
        self.Bind(wx.EVT_CONTEXT_MENU, self.onPopupMenu)
        self.Bind(wx.EVT_MENU, self.onSaveAsBitmap, id=self.ID_SaveAsBitmap)
        self.Bind(wx.EVT_MENU, self.onBlackAndWhite, id=self.ID_BlackAndWhite)

        if (self.bw):
            mbw.Check()


    def onPopupMenu(self, event):
        windowbehavior.popup_menu(self, self.pmenu, event)


    def onSaveAsBitmap(self, event):
        if not hasattr(self, 'buffer') or self.buffer is None:
            return

        name = self.chart.name+self.getExt()
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
        if (self.bw != event.IsChecked()):
            self.bw = event.IsChecked()
            self.drawBkg()
            self.Refresh()


    def OnPaint(self, event):
        buffer = getattr(self, 'buffer', None)
        if buffer is None:
            dc = wx.PaintDC(self)
            dc.Clear()
            return
        dc = wx.BufferedPaintDC(self, buffer, wx.BUFFER_VIRTUAL_AREA)


    def _load_font(self, path, logical_size):
        """Load a PIL font at physical resolution, wrapped in ScaledFont for logical measurements."""
        from PIL import ImageFont as _PF
        sc = wxcompat.get_dpi_scale()
        physical = max(1, int(round(logical_size * sc)))
        font = _PF.truetype(path, physical)
        return wxcompat.ScaledFont(font, sc) if sc != 1.0 else font

    def newScaledImageDraw(self, width, height, background_color):
        scale = wxcompat.get_dpi_scale(self)
        self._buffer_dpi_scale = scale
        physical_width = max(1, int(round(width * scale)))
        physical_height = max(1, int(round(height * scale)))
        image = PILImage.new('RGB', (physical_width, physical_height), background_color)
        draw = wxcompat.ScaledPILDraw(PILImageDraw.Draw(image), scale)
        return image, draw


    def scaledBitmapFromImage(self, image):
        wx_image = wx.Image(image.size[0], image.size[1])
        wx_image.SetData(image.tobytes())
        bitmap = wx.Bitmap(wx_image)
        scale = getattr(self, '_buffer_dpi_scale', wxcompat.get_dpi_scale(self))
        return wxcompat.set_bitmap_scale(bitmap, scale)




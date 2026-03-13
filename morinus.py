# -*- coding: utf-8 -*-
#!/usr/bin/env python


#Morinus, Astrology program
#Copyright (C) 2008-  Robert Nagy, robert.pluto@gmail.com

#This program is free software: you can redistribute it and/or modify
#it under the terms of the GNU General Public License as published by
#the Free Software Foundation, either version 3 of the License, or
#(at your option) any later version.

#This program is distributed in the hope that it will be useful,
#but WITHOUT ANY WARRANTY; without even the implied warranty of
#MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#GNU General Public License for more details.

#You should have received a copy of the GNU General Public License
#along with this program.  If not, see <http://www.gnu.org/licenses/>.

import os, sys
import datetime
import faulthandler

def _setup_frozen_logging():
	"""
	When running as a frozen macOS app, stdout/stderr aren't visible.
	Write diagnostics to a logfile to help debug startup issues.
	"""
	if not getattr(sys, "frozen", False):
		return
	try:
		log_dir = os.path.join(os.path.expanduser("~"), "Library", "Logs", "Morinus")
		os.makedirs(log_dir, exist_ok=True)
		log_path = os.path.join(log_dir, "morinus.log")
		log_fp = open(log_path, "a", buffering=1, encoding="utf-8", errors="replace")
		sys.stdout = log_fp
		sys.stderr = log_fp
		faulthandler.enable(log_fp)
		print("\n=== Morinus start ===")
		print(datetime.datetime.now().isoformat())
		print("executable:", sys.executable)
		print("argv:", sys.argv)
		print("base_dir:", _BASE_DIR if "_BASE_DIR" in globals() else None)
	except Exception:
		# Never fail startup due to logging issues.
		pass

_setup_frozen_logging()

# wxPython on macOS performs strict sizer flag consistency checks that can raise
# exceptions in Python for legacy code. Suppress those checks globally so the UI
# remains usable; layout issues can be fixed incrementally.
if sys.platform == "darwin":
	os.environ.setdefault("WXSUPPRESS_SIZER_FLAGS_CHECK", "1")

def _morinus_base_dir():
	if getattr(sys, "frozen", False):
		# Prefer the app bundle Resources directory on macOS (`.../Contents/Resources`)
		# so that relative paths like `Res/Morinus.jpg` work.
		try:
			contents_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), ".."))
			resources_dir = os.path.join(contents_dir, "Resources")
			if os.path.exists(os.path.join(resources_dir, "Res", "Morinus.jpg")):
				return resources_dir
		except Exception:
			pass

		# Fallback: PyInstaller sets `sys._MEIPASS` to the directory with bundled data.
		mei = getattr(sys, "_MEIPASS", None)
		if mei:
			return mei

	return os.path.dirname(os.path.abspath(__file__))

_BASE_DIR = _morinus_base_dir()
os.chdir(_BASE_DIR)
if getattr(sys, "frozen", False):
	try:
		print("resolved_base_dir:", _BASE_DIR)
		print("cwd:", os.getcwd())
	except Exception:
		pass

# Ensure the local Swiss Ephemeris extension (built from `SWEP/src`) is importable.
# - From source: `<repo>/SWEP/src`
# - PyInstaller macOS app bundle: `Contents/Frameworks/SWEP/src`
_swe_src_candidates = [os.path.join(_BASE_DIR, "SWEP", "src")]
if getattr(sys, "frozen", False):
	_fw_swe = os.path.abspath(
		os.path.join(os.path.dirname(sys.executable), "..", "Frameworks", "SWEP", "src")
	)
	_swe_src_candidates.append(_fw_swe)

for _swe_src in _swe_src_candidates:
	if os.path.isdir(_swe_src) and _swe_src not in sys.path:
		sys.path.insert(0, _swe_src)

import wx

if sys.platform == "darwin":
	# Avoid wxWidgets "consistency check" assertions from crashing legacy dialog layouts.
	try:
		wx.SizerFlags.DisableConsistencyChecks()
	except Exception:
		pass
	try:
		wx.DisableAsserts()
	except Exception:
		pass

import options
import mtexts
import morin
import wx

# 모든 플랫폼에서 MessageDialog -> GenericMessageDialog로 강제
_orig_MessageDialog = wx.MessageDialog
def _GenericMessageDialogFactory(parent, message, caption=wx.MessageBoxCaptionStr,
								 style=wx.OK | wx.CENTRE, pos=wx.DefaultPosition):
	return wx.GenericMessageDialog(parent, message, caption, style, pos)

wx.MessageDialog = _GenericMessageDialogFactory


class Morinus(wx.App):
	def OnExceptionInMainLoop(self):
		# Keep the app running even if a legacy handler crashes; log details.
		try:
			import traceback
			print("\n=== Unhandled UI exception ===")
			traceback.print_exc()

			def _show():
				dlg = wx.GenericMessageDialog(
					None,
					"A runtime error occurred. Details were written to morinus.log.\n\n"
					"You can continue, but some actions may not have completed.",
					"Morinus Error",
					wx.OK | wx.ICON_ERROR,
				)
				try:
					dlg.ShowModal()
				finally:
					dlg.Destroy()

			try:
				wx.CallAfter(_show)
			except Exception:
				pass
		except Exception:
			pass
		return True

	def OnInit(self):
		# Keep working directory pinned to the bundle/resource base dir.
		# On macOS app bundles, `sys.argv[0]` points to `.../Contents/MacOS/...`,
		# which breaks relative resource loading (e.g. `Res/Morinus.jpg`).
		try:
			os.chdir(_BASE_DIR)
		except Exception:
			pass

		# Ensure JPG/PNG handlers are registered before loading splash/resources.
		try:
			wx.InitAllImageHandlers()
		except Exception:
			pass

		#wx.SetDefaultPyEncoding('utf-8')
		opts = options.Options()
		mtexts.setLang(opts.langid)
		# ==== 1) 표준 메시지/확인창 버튼을 강제 현지화 ====
		import wx

		def _build_gmd(parent, msg, title, style):
			dlg = wx.GenericMessageDialog(parent, msg, title, style)
			try:
				if (style & wx.YES) and (style & wx.NO) and (style & wx.CANCEL):
					dlg.SetYesNoCancelLabels(mtexts.txts.get('Yes','Yes'),
											mtexts.txts.get('No','No'),
											mtexts.txts.get('Cancel','Cancel'))
				elif (style & wx.YES) and (style & wx.NO):
					dlg.SetYesNoLabels(mtexts.txts.get('Yes','Yes'),
									mtexts.txts.get('No','No'))
				elif (style & wx.OK):
					dlg.SetOKLabel(mtexts.txts.get('OK','OK'))
			except Exception:
				pass
			return dlg

		# wx.MessageDialog / MessageBox 대체
		def _MessageDialog(parent, message, caption, style):
			return _build_gmd(parent,
							mtexts.txts.get(message, message),
							mtexts.txts.get(caption, caption),
							style)

		def _MessageBox(message, caption='Message',
						style=wx.OK|wx.CENTRE, parent=None, x=wx.DefaultCoord, y=wx.DefaultCoord):
			dlg = _build_gmd(parent,
							mtexts.txts.get(message, message),
							mtexts.txts.get(caption, caption),
							style)
			try:
				return dlg.ShowModal()
			finally:
				dlg.Destroy()

		wx.MessageDialog = _MessageDialog
		wx.MessageBox    = _MessageBox

		# ==== 2) 모든 다이얼로그가 뜨기 직전에 OK/Cancel/Yes/No 라벨을 일괄 치환 ====
		_ID2KEY = {
			wx.ID_OK:'OK', wx.ID_CANCEL:'Cancel',
			wx.ID_YES:'Yes', wx.ID_NO:'No',
			wx.ID_APPLY:'Apply', wx.ID_CLOSE:'Close'
		}

		def _localize_stock_buttons(root):
			# 다이얼로그 트리에 있는 모든 버튼 라벨을 앱 언어로 통일
			stack = [root]
			while stack:
				w = stack.pop()
				try:
					for c in w.GetChildren():
						stack.append(c)
				except Exception:
					pass
				if isinstance(w, wx.Button):
					key = _ID2KEY.get(w.GetId())
					if key:
						desired = mtexts.txts.get(key, w.GetLabel())
						if w.GetLabel() != desired:
							try:
								w.SetLabel(desired)
							except Exception:
								pass
			try:
				root.Layout()
			except Exception:
				pass

		# 모든 다이얼로그에 자동 적용 (Show/ShowModal 훅)
		_orig_show_modal = wx.Dialog.ShowModal
		def _patched_show_modal(self, *a, **k):
			_localize_stock_buttons(self)
			return _orig_show_modal(self, *a, **k)
		wx.Dialog.ShowModal = _patched_show_modal

		_orig_show = wx.Dialog.Show
		def _patched_show(self, *a, **k):
			_localize_stock_buttons(self)
			return _orig_show(self, *a, **k)
		wx.Dialog.Show = _patched_show

		import dlgutils

		# wx.MessageDialog / MessageBox를 강제 현지화 버전으로 바꿔치기
		import wx
		def _MsgDialog(parent, message, caption, style):
			# message/caption 둘 다 mtexts 키 또는 생 텍스트를 허용
			msg   = mtexts.txts.get(message, message)
			title = mtexts.txts.get(caption, caption)
			return dlgutils._build_gmd(parent, msg, title, style)

		def _MessageBox(message, caption='Message', style=wx.OK|wx.CENTRE, parent=None, x=wx.DefaultCoord, y=wx.DefaultCoord):
			dlg = _MsgDialog(parent, message, caption, style)
			try:
				return dlg.ShowModal()
			finally:
				dlg.Destroy()

		wx.MessageDialog = _MsgDialog          # 클래스 대체
		wx.MessageBox    = _MessageBox         # 함수 대체

		# Keep a strong reference; otherwise the frame may be garbage-collected
		# and the app ends up with no visible windows (platform-dependent).
		self.frame = morin.MFrame(None, -1, mtexts.txts['Morinus'], opts)
		self.SetTopWindow(self.frame)
		self.frame.Show(True)

		return True


def main():
	app = Morinus(0)
	app.MainLoop()


if __name__ == "__main__":
	main()

import time
import wx


MAIN_QUICK_SHORTCUTS = (
	('T', 'onTransits'),
	('R', 'onQuickSolarRevolution'),
	('P', 'onProfectionsChart'),
	('D', 'onPrimaryDirs'),
)


def apply_main_shortcut_labels(frame):
	for menu_name, item_id, label in (
		('ctransits', frame.ID_Transits, 'Transits\tT'),
		('mcharts', frame.ID_Revolutions, 'Solar Revolution\tR'),
		('mcharts', frame.ID_OtherRevolutions, 'Other Revolutions...'),
		('mcharts', frame.ID_ProfectionsChart, 'Profections Chart\tP'),
		('mtable', frame.ID_Profections, 'Profections'),
		('mtable', frame.ID_PrimaryDirs, 'Primary Directions Lists\tD'),
	):
		try:
			getattr(frame, menu_name).SetLabel(item_id, label)
		except Exception:
			pass


def handle_main_quick_shortcut(frame, keycode):
	for key, handler_name in MAIN_QUICK_SHORTCUTS:
		if keycode not in (ord(key), ord(key.lower())):
			continue
		if getattr(frame, 'splash', True):
			return False
		handler = getattr(frame, handler_name, None)
		if handler is None:
			return False
		handler(None)
		return True
	return False


def handle_main_key_event(frame, event):
	if event is None:
		return False

	if event.AltDown() or event.ControlDown() or event.CmdDown():
		return False

	keycode = event.GetKeyCode()

	if keycode == wx.WXK_ESCAPE:
		dismiss = getattr(frame, '_dismiss_active_table', None)
		if callable(dismiss) and dismiss():
			return True

	return handle_main_quick_shortcut(frame, keycode)


def handle_transit_key_event(frame, event):
	if event is None:
		return False

	if event.ControlDown() or event.CmdDown():
		return False

	alt_down = event.AltDown()
	shift_down = event.ShiftDown()
	keycode_raw = event.GetKeyCode()

	if not alt_down and not shift_down and keycode_raw in (wx.WXK_SPACE, ord(' ')):
		reset_handler = getattr(frame, 'reset_to_initial_chart', None)
		if callable(reset_handler):
			return bool(reset_handler())
		return False

	keycode = frame._normalized_nav_key(keycode_raw)

	# Handle arrow navigation including Alt/Shift modifier combos
	# (must be processed here, before macOS consumes Option+Arrow)
	if keycode in (wx.WXK_LEFT, wx.WXK_RIGHT, wx.WXK_UP, wx.WXK_DOWN):
		if frame._navigate_intrinsically(
			keycode,
			shift_down=shift_down,
			alt_down=alt_down,
		):
			return True

		if frame._forward_stepper_arrow(
			keycode,
			shift_down=shift_down,
			alt_down=alt_down,
			control_down=False,
			cmd_down=False,
		):
			return True

	# Don't handle non-arrow keys when Alt is held
	if alt_down:
		return False

	if keycode_raw == wx.WXK_TAB:
		now = time.monotonic()
		last_toggle = getattr(frame, '_last_tab_toggle', 0.0)
		if now - last_toggle > 0.20:
			frame._last_tab_toggle = now
			frame.toggleComparisonView()
		return True

	return False

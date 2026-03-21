import keyboard_layers


class _DummyMenu(object):
    def __init__(self):
        self.calls = []

    def SetLabel(self, item_id, label):
        self.calls.append((item_id, label))


class _DummyFrame(object):
    ID_Transits = 1
    ID_Revolutions = 2
    ID_OtherRevolutions = 3
    ID_ProfectionsChart = 4
    ID_Profections = 5
    ID_PrimaryDirs = 6

    def __init__(self, splash=False):
        self.splash = splash
        self.calls = []
        self.ctransits = _DummyMenu()
        self.mcharts = _DummyMenu()
        self.mtable = _DummyMenu()

    def onTransits(self, _event):
        self.calls.append("transits")

    def onQuickSolarRevolution(self, _event):
        self.calls.append("solar")

    def onProfectionsChart(self, _event):
        self.calls.append("profections")

    def onPrimaryDirs(self, _event):
        self.calls.append("dirs")


class _DummyEvent(object):
    def __init__(self, keycode, alt=False, ctrl=False, cmd=False, shift=False):
        self._keycode = keycode
        self._alt = alt
        self._ctrl = ctrl
        self._cmd = cmd
        self._shift = shift

    def AltDown(self):
        return self._alt

    def ControlDown(self):
        return self._ctrl

    def CmdDown(self):
        return self._cmd

    def ShiftDown(self):
        return self._shift

    def GetKeyCode(self):
        return self._keycode


def test_apply_main_shortcut_labels_updates_expected_menu_entries():
    frame = _DummyFrame()

    keyboard_layers.apply_main_shortcut_labels(frame)

    assert frame.ctransits.calls == [(frame.ID_Transits, "Transits\tT")]
    assert frame.mcharts.calls == [
        (frame.ID_Revolutions, "Solar Revolution\tR"),
        (frame.ID_OtherRevolutions, "Other Revolutions..."),
        (frame.ID_ProfectionsChart, "Profections Chart\tP"),
    ]
    assert frame.mtable.calls == [
        (frame.ID_Profections, "Profections"),
        (frame.ID_PrimaryDirs, "Primary Directions Lists\tD"),
    ]


def test_handle_main_quick_shortcut_ignores_splash_screen():
    frame = _DummyFrame(splash=True)

    handled = keyboard_layers.handle_main_quick_shortcut(frame, ord("T"))

    assert handled is False
    assert frame.calls == []


def test_handle_main_quick_shortcut_dispatches_matching_handler_case_insensitively():
    frame = _DummyFrame()

    handled = keyboard_layers.handle_main_quick_shortcut(frame, ord("r"))

    assert handled is True
    assert frame.calls == ["solar"]


def test_handle_main_key_event_ignores_modified_shortcuts():
    frame = _DummyFrame()

    handled = keyboard_layers.handle_main_key_event(
        frame, _DummyEvent(ord("T"), ctrl=True)
    )

    assert handled is False
    assert frame.calls == []

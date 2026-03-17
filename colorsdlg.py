import wx
import astrology
import chart
import mtexts


_PICKER_SIZE = (38, -1)
_GRID_VGAP = 6
_GRID_HGAP = 12
_SECTION_TOP = 3
_SECTION_INSET = 3
_ROW_GAP = 6
_OUTER_GAP = 4


class ColorsDlg(wx.Dialog):
	def __init__(self, parent):
		wx.Dialog.__init__(self, parent, -1, mtexts.txts['Colors'], pos=wx.DefaultPosition, size=wx.DefaultSize, style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)

		self.digtxts = []
		self.pltxts = []

		mvsizer = wx.BoxSizer(wx.VERTICAL)
		notebook = wx.Notebook(self, -1)

		chart_page = wx.Panel(notebook, -1)
		bodies_page = wx.Panel(notebook, -1)
		aspects_page = wx.Panel(notebook, -1)
		general_page = wx.Panel(notebook, -1)

		self._build_chart_page(chart_page)
		self._build_bodies_page(bodies_page)
		self._build_aspects_page(aspects_page)
		self._build_general_page(general_page)

		notebook.AddPage(chart_page, mtexts.txts["Chart"])
		notebook.AddPage(bodies_page, mtexts.txts["Individual"])
		notebook.AddPage(aspects_page, mtexts.txts["Aspects"])
		notebook.AddPage(general_page, mtexts.txts["General"])

		mvsizer.Add(notebook, 1, wx.EXPAND | wx.ALL, 8)

		bottom_sizer = wx.BoxSizer(wx.HORIZONTAL)

		restorebtn = wx.Button(self, wx.ID_ANY, mtexts.txts.get('RestoreDefault', 'Restore Default'))
		self.Bind(wx.EVT_BUTTON, self.onRestoreDefaults, id=restorebtn.GetId())
		bottom_sizer.Add(restorebtn, 0, wx.ALIGN_CENTER_VERTICAL)
		bottom_sizer.AddStretchSpacer()

		btnsizer = wx.StdDialogButtonSizer()

		okbtn = wx.Button(self, wx.ID_OK, mtexts.txts['Ok'])
		okbtn.SetDefault()
		btnsizer.AddButton(okbtn)

		cancelbtn = wx.Button(self, wx.ID_CANCEL, mtexts.txts['Cancel'])
		btnsizer.AddButton(cancelbtn)
		btnsizer.Realize()

		bottom_sizer.Add(btnsizer, 0, wx.ALIGN_CENTER_VERTICAL)
		mvsizer.Add(bottom_sizer, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
		self.SetSizer(mvsizer)
		mvsizer.Fit(self)
		fitted = self.GetSize()
		w = max(350, fitted.width)
		self.SetMinSize((w, fitted.height))
		self.SetSize((w, fitted.height))

		okbtn.SetFocus()


	def _build_chart_page(self, page):
		page_sizer = wx.BoxSizer(wx.VERTICAL)

		chart_box = wx.StaticBox(page, label=mtexts.txts["Chart"])
		chart_sizer = wx.StaticBoxSizer(chart_box, wx.VERTICAL)
		grid = wx.FlexGridSizer(6, 2, _GRID_VGAP, _GRID_HGAP)
		grid.AddGrowableCol(0, 1)
		self.btnFrame, _ = self._add_picker_row(page, grid, mtexts.txts['Frame'], wx.NewId())
		self.btnSigns, _ = self._add_picker_row(page, grid, mtexts.txts['Signs'], wx.NewId())
		self.btnAscMC, _ = self._add_picker_row(page, grid, mtexts.txts['AscMC'], wx.NewId())
		self.btnHouses, _ = self._add_picker_row(page, grid, mtexts.txts['Houses'], wx.NewId())
		self.btnHouseNumbers, _ = self._add_picker_row(page, grid, mtexts.txts['Housenames'], wx.NewId())
		self.btnPositions, _ = self._add_picker_row(page, grid, mtexts.txts['Positions'], wx.NewId())
		chart_sizer.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.TOP | wx.RIGHT, _SECTION_INSET)
		page_sizer.Add(chart_sizer, 0, wx.EXPAND | wx.ALL, 8)

		dignities_box = wx.StaticBox(page, label=mtexts.txts["Dignities"])
		dignities_sizer = wx.StaticBoxSizer(dignities_box, wx.VERTICAL)
		grid = wx.FlexGridSizer(5, 2, _GRID_VGAP, _GRID_HGAP)
		grid.AddGrowableCol(0, 1)
		self.btnDomicil, label = self._add_picker_row(page, grid, mtexts.txts['Domicil'], wx.NewId())
		self.digtxts.append(label)
		self.btnExal, label = self._add_picker_row(page, grid, mtexts.txts['Exal'], wx.NewId())
		self.digtxts.append(label)
		self.btnPeregrin, label = self._add_picker_row(page, grid, mtexts.txts['Peregrin'], wx.NewId())
		self.digtxts.append(label)
		self.btnCasus, label = self._add_picker_row(page, grid, mtexts.txts['Casus'], wx.NewId())
		self.digtxts.append(label)
		self.btnExil, label = self._add_picker_row(page, grid, mtexts.txts['Exil'], wx.NewId())
		self.digtxts.append(label)
		dignities_sizer.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.TOP | wx.RIGHT, _SECTION_INSET)
		page_sizer.Add(dignities_sizer, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

		page_sizer.AddStretchSpacer()
		page.SetSizer(page_sizer)


	def _build_bodies_page(self, page):
		page_sizer = wx.BoxSizer(wx.VERTICAL)

		individual_box = wx.StaticBox(page, label=mtexts.txts["Individual"])
		individual_sizer = wx.StaticBoxSizer(individual_box, wx.VERTICAL)
		grid = wx.FlexGridSizer(12, 2, _GRID_VGAP, _GRID_HGAP)
		grid.AddGrowableCol(0, 1)
		self.btnSun, label = self._add_picker_row(page, grid, mtexts.txts['Sun'], wx.NewId())
		self.pltxts.append(label)
		self.btnMoon, label = self._add_picker_row(page, grid, mtexts.txts['Moon'], wx.NewId())
		self.pltxts.append(label)
		self.btnMercury, label = self._add_picker_row(page, grid, mtexts.txts['Mercury'], wx.NewId())
		self.pltxts.append(label)
		self.btnVenus, label = self._add_picker_row(page, grid, mtexts.txts['Venus'], wx.NewId())
		self.pltxts.append(label)
		self.btnMars, label = self._add_picker_row(page, grid, mtexts.txts['Mars'], wx.NewId())
		self.pltxts.append(label)
		self.btnJupiter, label = self._add_picker_row(page, grid, mtexts.txts['Jupiter'], wx.NewId())
		self.pltxts.append(label)
		self.btnSaturn, label = self._add_picker_row(page, grid, mtexts.txts['Saturn'], wx.NewId())
		self.pltxts.append(label)
		self.btnUranus, label = self._add_picker_row(page, grid, mtexts.txts['Uranus'], wx.NewId())
		self.pltxts.append(label)
		self.btnNeptune, label = self._add_picker_row(page, grid, mtexts.txts['Neptune'], wx.NewId())
		self.pltxts.append(label)
		self.btnPluto, label = self._add_picker_row(page, grid, mtexts.txts['Pluto'], wx.NewId())
		self.pltxts.append(label)
		self.btnNodes, label = self._add_picker_row(page, grid, mtexts.txts['Nodes'], wx.NewId())
		self.pltxts.append(label)
		self.btnLoF, label = self._add_picker_row(page, grid, mtexts.txts['LoF'], wx.NewId())
		self.pltxts.append(label)
		individual_sizer.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.TOP | wx.RIGHT, _SECTION_INSET)
		page_sizer.Add(individual_sizer, 0, wx.EXPAND | wx.ALL, 8)

		self.useplanetcolorsckb = wx.CheckBox(page, -1, mtexts.txts['UseIndividual'])
		self.Bind(wx.EVT_CHECKBOX, self.onUsePlanetColors, id=self.useplanetcolorsckb.GetId())
		page_sizer.Add(self.useplanetcolorsckb, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)
		page_sizer.AddStretchSpacer()
		page.SetSizer(page_sizer)


	def _build_aspects_page(self, page):
		page_sizer = wx.BoxSizer(wx.VERTICAL)

		aspects_box = wx.StaticBox(page, label=mtexts.txts["Aspects"])
		aspects_sizer = wx.StaticBoxSizer(aspects_box, wx.VERTICAL)
		grid = wx.FlexGridSizer(11, 2, _GRID_VGAP, _GRID_HGAP)
		grid.AddGrowableCol(0, 1)
		self.btnConjunctio, _ = self._add_picker_row(page, grid, mtexts.txts['Conjunctio'], wx.NewId())
		self.btnSemisextil, _ = self._add_picker_row(page, grid, mtexts.txts['Semisextil'], wx.NewId())
		self.btnSemiquadrat, _ = self._add_picker_row(page, grid, mtexts.txts['Semiquadrat'], wx.NewId())
		self.btnSextil, _ = self._add_picker_row(page, grid, mtexts.txts['Sextil'], wx.NewId())
		self.btnQuintile, _ = self._add_picker_row(page, grid, mtexts.txts['Quintile'], wx.NewId())
		self.btnQuadrat, _ = self._add_picker_row(page, grid, mtexts.txts['Quadrat'], wx.NewId())
		self.btnTrigon, _ = self._add_picker_row(page, grid, mtexts.txts['Trigon'], wx.NewId())
		self.btnSesquiquadrat, _ = self._add_picker_row(page, grid, mtexts.txts['Sesquiquadrat'], wx.NewId())
		self.btnBiquintile, _ = self._add_picker_row(page, grid, mtexts.txts['Biquintile'], wx.NewId())
		self.btnQuinqunx, _ = self._add_picker_row(page, grid, mtexts.txts['Quinqunx'], wx.NewId())
		self.btnOppositio, _ = self._add_picker_row(page, grid, mtexts.txts['Oppositio'], wx.NewId())
		aspects_sizer.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.TOP | wx.RIGHT, _SECTION_INSET)
		page_sizer.Add(aspects_sizer, 0, wx.EXPAND | wx.ALL, 8)
		page_sizer.AddStretchSpacer()
		page.SetSizer(page_sizer)


	def _build_general_page(self, page):
		page_sizer = wx.BoxSizer(wx.VERTICAL)

		general_box = wx.StaticBox(page, label=mtexts.txts["General"])
		general_sizer = wx.StaticBoxSizer(general_box, wx.VERTICAL)
		grid = wx.FlexGridSizer(5, 2, _GRID_VGAP, _GRID_HGAP)
		grid.AddGrowableCol(0, 1)
		self.btnBackground, _ = self._add_picker_row(page, grid, mtexts.txts['Background'], wx.NewId())
		self.btnSidebar, _ = self._add_picker_row(page, grid, mtexts.txts.get('Sidebar', 'Sidebar'), wx.NewId())
		self.btnSidebarTexts, _ = self._add_picker_row(page, grid, mtexts.txts.get('SidebarTexts', 'Sidebar Texts'), wx.NewId())
		self.btnTable, _ = self._add_picker_row(page, grid, mtexts.txts['Table'], wx.NewId())
		self.btnTexts, _ = self._add_picker_row(page, grid, mtexts.txts['Texts'], wx.NewId())
		general_sizer.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.TOP | wx.RIGHT, _SECTION_INSET)
		page_sizer.Add(general_sizer, 0, wx.EXPAND | wx.ALL, 8)
		page_sizer.AddStretchSpacer()
		page.SetSizer(page_sizer)


	def _add_picker_row(self, parent, sizer, label_text, ctrl_id):
		label = wx.StaticText(parent, -1, label_text+':')
		sizer.Add(label, 0, wx.ALIGN_CENTER_VERTICAL | wx.ALL, 1)
		picker = self._make_picker(ctrl_id, parent)
		sizer.Add(picker, 0, wx.ALIGN_RIGHT | wx.ALL, 1)
		return picker, label


	def _make_picker(self, ctrl_id, parent=None):
		if parent is None:
			parent = self
		picker = wx.ColourPickerCtrl(parent, ctrl_id, wx.BLACK, size=_PICKER_SIZE)
		return picker


	def _set_picker_colour(self, picker, colour):
		if isinstance(colour, wx.Colour):
			picker.SetColour(colour)
		else:
			picker.SetColour(wx.Colour(*colour))


	def _get_picker_colour(self, picker):
		return picker.GetColour().Get(False)


	def onUsePlanetColors(self, event):
		self.changeState(self.useplanetcolorsckb.GetValue())


	def changeState(self, enable):
		arplanets = [self.btnSun, self.btnMoon, self.btnMercury, self.btnVenus, self.btnMars, self.btnJupiter, self.btnSaturn, self.btnUranus, self.btnNeptune, self.btnPluto, self.btnNodes, self.btnLoF]
		ardignities = [self.btnDomicil, self.btnExal, self.btnPeregrin, self.btnCasus, self.btnExil]

		for it in self.pltxts:
			it.Enable(enable)

		for it in arplanets:
			it.Enable(enable)

		for it in self.digtxts:
			it.Enable(not enable)

		for it in ardignities:
			it.Enable(not enable)


	def onRestoreDefaults(self, event):
		if not hasattr(self, '_options'):
			return
		opts = self._options
		for picker, value in (
			(self.btnFrame, opts.def_clrframe),
			(self.btnSigns, opts.def_clrsigns),
			(self.btnAscMC, opts.def_clrAscMC),
			(self.btnHouses, opts.def_clrhouses),
			(self.btnHouseNumbers, opts.def_clrhousenumbers),
			(self.btnPositions, opts.def_clrpositions),
			(self.btnPeregrin, opts.def_clrperegrin),
			(self.btnDomicil, opts.def_clrdomicil),
			(self.btnExil, opts.def_clrexil),
			(self.btnExal, opts.def_clrexal),
			(self.btnCasus, opts.def_clrcasus),
			(self.btnBackground, opts.def_clrbackground),
			(self.btnSidebar, opts.def_clrsidebar),
			(self.btnSidebarTexts, opts.def_clrsidebartext),
			(self.btnTable, opts.def_clrtable),
			(self.btnTexts, opts.def_clrtexts),
		):
			self._set_picker_colour(picker, value)

		for index, picker in (
			(astrology.SE_SUN, self.btnSun),
			(astrology.SE_MOON, self.btnMoon),
			(astrology.SE_MERCURY, self.btnMercury),
			(astrology.SE_VENUS, self.btnVenus),
			(astrology.SE_MARS, self.btnMars),
			(astrology.SE_JUPITER, self.btnJupiter),
			(astrology.SE_SATURN, self.btnSaturn),
			(astrology.SE_URANUS, self.btnUranus),
			(astrology.SE_NEPTUNE, self.btnNeptune),
			(astrology.SE_PLUTO, self.btnPluto),
			(astrology.SE_PLUTO+1, self.btnNodes),
			(astrology.SE_PLUTO+2, self.btnLoF),
		):
			self._set_picker_colour(picker, opts.def_clrindividual[index])

		for index, picker in (
			(chart.Chart.CONJUNCTIO, self.btnConjunctio),
			(chart.Chart.SEMISEXTIL, self.btnSemisextil),
			(chart.Chart.SEMIQUADRAT, self.btnSemiquadrat),
			(chart.Chart.SEXTIL, self.btnSextil),
			(chart.Chart.QUINTILE, self.btnQuintile),
			(chart.Chart.QUADRAT, self.btnQuadrat),
			(chart.Chart.TRIGON, self.btnTrigon),
			(chart.Chart.SESQUIQUADRAT, self.btnSesquiquadrat),
			(chart.Chart.BIQUINTILE, self.btnBiquintile),
			(chart.Chart.QUINQUNX, self.btnQuinqunx),
			(chart.Chart.OPPOSITIO, self.btnOppositio),
		):
			self._set_picker_colour(picker, opts.def_clraspect[index])

		self.useplanetcolorsckb.SetValue(opts.def_useplanetcolors)
		self.changeState(opts.def_useplanetcolors)


	def fill(self, options):
		self._options = options
		for picker, value in (
			(self.btnFrame, options.clrframe),
			(self.btnSigns, options.clrsigns),
			(self.btnAscMC, options.clrAscMC),
			(self.btnHouses, options.clrhouses),
			(self.btnHouseNumbers, options.clrhousenumbers),
			(self.btnPositions, options.clrpositions),
			(self.btnPeregrin, options.clrperegrin),
			(self.btnDomicil, options.clrdomicil),
			(self.btnExil, options.clrexil),
			(self.btnExal, options.clrexal),
			(self.btnCasus, options.clrcasus),
			(self.btnBackground, options.clrbackground),
			(self.btnSidebar, getattr(options, 'clrsidebar', options.clrbackground)),
			(self.btnSidebarTexts, getattr(options, 'clrsidebartext', options.clrtexts)),
			(self.btnTable, options.clrtable),
			(self.btnTexts, options.clrtexts),
		):
			self._set_picker_colour(picker, value)

		for index, picker in (
			(astrology.SE_SUN, self.btnSun),
			(astrology.SE_MOON, self.btnMoon),
			(astrology.SE_MERCURY, self.btnMercury),
			(astrology.SE_VENUS, self.btnVenus),
			(astrology.SE_MARS, self.btnMars),
			(astrology.SE_JUPITER, self.btnJupiter),
			(astrology.SE_SATURN, self.btnSaturn),
			(astrology.SE_URANUS, self.btnUranus),
			(astrology.SE_NEPTUNE, self.btnNeptune),
			(astrology.SE_PLUTO, self.btnPluto),
			(astrology.SE_PLUTO+1, self.btnNodes),
			(astrology.SE_PLUTO+2, self.btnLoF),
		):
			self._set_picker_colour(picker, options.clrindividual[index])

		for index, picker in (
			(chart.Chart.CONJUNCTIO, self.btnConjunctio),
			(chart.Chart.SEMISEXTIL, self.btnSemisextil),
			(chart.Chart.SEMIQUADRAT, self.btnSemiquadrat),
			(chart.Chart.SEXTIL, self.btnSextil),
			(chart.Chart.QUINTILE, self.btnQuintile),
			(chart.Chart.QUADRAT, self.btnQuadrat),
			(chart.Chart.TRIGON, self.btnTrigon),
			(chart.Chart.SESQUIQUADRAT, self.btnSesquiquadrat),
			(chart.Chart.BIQUINTILE, self.btnBiquintile),
			(chart.Chart.QUINQUNX, self.btnQuinqunx),
			(chart.Chart.OPPOSITIO, self.btnOppositio),
		):
			self._set_picker_colour(picker, options.clraspect[index])

		self.useplanetcolorsckb.SetValue(options.useplanetcolors)

		self.changeState(self.useplanetcolorsckb.GetValue())


	def check(self, options):
		changed = False

		for attr_name, picker in (
			('clrframe', self.btnFrame),
			('clrsigns', self.btnSigns),
			('clrAscMC', self.btnAscMC),
			('clrhouses', self.btnHouses),
			('clrhousenumbers', self.btnHouseNumbers),
			('clrpositions', self.btnPositions),
			('clrperegrin', self.btnPeregrin),
			('clrdomicil', self.btnDomicil),
			('clrexil', self.btnExil),
			('clrexal', self.btnExal),
			('clrcasus', self.btnCasus),
			('clrbackground', self.btnBackground),
			('clrsidebar', self.btnSidebar),
			('clrsidebartext', self.btnSidebarTexts),
			('clrtable', self.btnTable),
			('clrtexts', self.btnTexts),
		):
			value = self._get_picker_colour(picker)
			if getattr(options, attr_name) != value:
				setattr(options, attr_name, value)
				changed = True

		for index, picker in (
			(astrology.SE_SUN, self.btnSun),
			(astrology.SE_MOON, self.btnMoon),
			(astrology.SE_MERCURY, self.btnMercury),
			(astrology.SE_VENUS, self.btnVenus),
			(astrology.SE_MARS, self.btnMars),
			(astrology.SE_JUPITER, self.btnJupiter),
			(astrology.SE_SATURN, self.btnSaturn),
			(astrology.SE_URANUS, self.btnUranus),
			(astrology.SE_NEPTUNE, self.btnNeptune),
			(astrology.SE_PLUTO, self.btnPluto),
			(astrology.SE_PLUTO+1, self.btnNodes),
			(astrology.SE_PLUTO+2, self.btnLoF),
		):
			value = self._get_picker_colour(picker)
			if options.clrindividual[index] != value:
				options.clrindividual[index] = value
				changed = True

		for index, picker in (
			(chart.Chart.CONJUNCTIO, self.btnConjunctio),
			(chart.Chart.SEMISEXTIL, self.btnSemisextil),
			(chart.Chart.SEMIQUADRAT, self.btnSemiquadrat),
			(chart.Chart.SEXTIL, self.btnSextil),
			(chart.Chart.QUINTILE, self.btnQuintile),
			(chart.Chart.QUADRAT, self.btnQuadrat),
			(chart.Chart.TRIGON, self.btnTrigon),
			(chart.Chart.SESQUIQUADRAT, self.btnSesquiquadrat),
			(chart.Chart.BIQUINTILE, self.btnBiquintile),
			(chart.Chart.QUINQUNX, self.btnQuinqunx),
			(chart.Chart.OPPOSITIO, self.btnOppositio),
		):
			value = self._get_picker_colour(picker)
			if options.clraspect[index] != value:
				options.clraspect[index] = value
				changed = True

		if options.useplanetcolors != self.useplanetcolorsckb.GetValue():
			options.useplanetcolors = self.useplanetcolorsckb.GetValue()
			changed = True

		return changed

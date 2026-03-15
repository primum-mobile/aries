# -*- coding: utf-8 -*-

import datetime
import wx
import wx.adv
import mtexts
import common
import chart
import astrology
import profections
import profectionsframe
import searchcatalog
import searchbackend
import searchquery
import transitframe
import Image, ImageDraw, ImageFont


class SearchWnd(wx.Panel):
	RESULT_LIMIT = 500
	RESULT_GLYPH_COL = 0

	def __init__(self, parent, chrt, options, mainfr):
		wx.Panel.__init__(self, parent, -1)

		self.parent = parent
		self.chart = chrt
		self.options = options
		self.mainfr = mainfr

		self.catalog = searchcatalog.SearchCatalog(chrt)
		self.query = searchquery.SearchQuery()
		self.filtered_part_ids = []
		self.results = []

		self.technique_labels = {
			searchquery.SearchQuery.TECHNIQUE_TRANSITS: mtexts.txts['Transits'],
			searchquery.SearchQuery.TECHNIQUE_PROFECTIONS: mtexts.txts['Profections'],
			searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS: mtexts.txts['PrimaryDirs'],
		}

		self.promittor_ids = self.catalog.promittor_ids[:]
		self.builtin_significator_ids = self.catalog.builtin_significator_ids[:]
		self.part_ids = self.catalog.part_ids[:]

		self._build_ui()
		self._apply_compact_font()
		self._apply_defaults()
		self._sync_all_controls_from_query()
		self._refresh_selection_summary()


	def _build_ui(self):
		mvsizer = wx.BoxSizer(wx.VERTICAL)

		self.splitter = wx.SplitterWindow(self, -1, style=wx.SP_LIVE_UPDATE|wx.SP_3D)
		leftpanel = wx.ScrolledWindow(self.splitter, -1, style=wx.VSCROLL|wx.TAB_TRAVERSAL)
		rightpanel = wx.Panel(self.splitter, -1)
		leftpanel.SetScrollRate(10, 10)
		self.splitter.SetMinimumPaneSize(280)
		self.splitter.SplitVertically(leftpanel, rightpanel, 365)
		mvsizer.Add(self.splitter, 1, wx.EXPAND|wx.ALL, 6)

		self._build_left_panel(leftpanel)
		self._build_right_panel(rightpanel)

		self.SetSizer(mvsizer)


	def _build_left_panel(self, panel):
		mvsizer = wx.BoxSizer(wx.VERTICAL)

		techbox = wx.StaticBoxSizer(wx.StaticBox(panel, -1, 'Techniques'), wx.VERTICAL)
		self.transitsckb = wx.CheckBox(panel, -1, mtexts.txts['Transits'])
		self.profectionsckb = wx.CheckBox(panel, -1, mtexts.txts['Profections'])
		self.primarydirsckb = wx.CheckBox(panel, -1, mtexts.txts['PrimaryDirs'])
		techbox.Add(self.transitsckb, 0, wx.ALL, 2)
		techbox.Add(self.profectionsckb, 0, wx.LEFT|wx.RIGHT|wx.BOTTOM, 2)
		techbox.Add(self.primarydirsckb, 0, wx.LEFT|wx.RIGHT|wx.BOTTOM, 2)
		self.primarydirsckb.Enable(False)
		self.transitsckb.Bind(wx.EVT_CHECKBOX, self._on_selection_changed)
		self.profectionsckb.Bind(wx.EVT_CHECKBOX, self._on_selection_changed)
		self.primarydirsckb.Bind(wx.EVT_CHECKBOX, self._on_selection_changed)
		mvsizer.Add(techbox, 0, wx.EXPAND|wx.ALL, 4)

		aspectbox = wx.StaticBoxSizer(wx.StaticBox(panel, -1, 'Aspects'), wx.VERTICAL)
		self.aspectbuttons = {}
		gridsizer = wx.GridSizer(2, 3, 4, 4)
		for aspect_id, chart_aspect, both_sides, label in searchbackend.ASPECT_DEFS:
			btn = wx.BitmapToggleButton(panel, -1, self._render_aspect_bitmap(common.common.Aspects[chart_aspect], self.options.clraspect[chart_aspect]), size=(36, 28))
			btn.SetToolTip(label)
			btn.Bind(wx.EVT_TOGGLEBUTTON, self._on_selection_changed)
			self.aspectbuttons[aspect_id] = btn
			gridsizer.Add(btn, 0, wx.EXPAND)
		aspectbox.Add(gridsizer, 0, wx.ALL, 2)
		mvsizer.Add(aspectbox, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 4)

		prombox = wx.StaticBoxSizer(wx.StaticBox(panel, -1, mtexts.txts['Promissors']), wx.VERTICAL)
		prombuttons = wx.BoxSizer(wx.HORIZONTAL)
		self._add_button(panel, prombuttons, 'All', self._on_promittors_all)
		self._add_button(panel, prombuttons, 'Planets', self._on_promittors_planets)
		self._add_button(panel, prombuttons, 'Core 7', self._on_promittors_core)
		self._add_button(panel, prombuttons, 'Clear', self._on_promittors_clear)
		prombox.Add(prombuttons, 0, wx.EXPAND|wx.ALL, 2)

		self.promittorclb = wx.CheckListBox(panel, -1, choices=self.catalog.get_labels(self.promittor_ids), size=(-1, 185))
		self.promittorclb.Bind(wx.EVT_CHECKLISTBOX, self._on_selection_changed)
		prombox.Add(self.promittorclb, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 2)
		mvsizer.Add(prombox, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 4)

		sigbox = wx.StaticBoxSizer(wx.StaticBox(panel, -1, mtexts.txts['Significators']), wx.VERTICAL)
		sigbuttons = wx.BoxSizer(wx.HORIZONTAL)
		self._add_button(panel, sigbuttons, 'All built-ins', self._on_significators_all_builtin)
		self._add_button(panel, sigbuttons, 'Planets', self._on_significators_planets)
		self._add_button(panel, sigbuttons, 'Clear', self._on_significators_clear_builtin)
		sigbox.Add(sigbuttons, 0, wx.EXPAND|wx.ALL, 2)

		self.significatorclb = wx.CheckListBox(panel, -1, choices=self.catalog.get_labels(self.builtin_significator_ids), size=(-1, 150))
		self.significatorclb.Bind(wx.EVT_CHECKLISTBOX, self._on_selection_changed)
		sigbox.Add(self.significatorclb, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 2)

		filterlabel = wx.StaticText(panel, -1, mtexts.txts['ArabicParts']+' Filter')
		sigbox.Add(filterlabel, 0, wx.LEFT|wx.RIGHT|wx.TOP, 2)
		self.partfilter = wx.TextCtrl(panel, -1, '')
		self.partfilter.Bind(wx.EVT_TEXT, self._on_part_filter)
		sigbox.Add(self.partfilter, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 2)

		partbuttons = wx.BoxSizer(wx.HORIZONTAL)
		self._add_button(panel, partbuttons, 'All parts', self._on_parts_all)
		self._add_button(panel, partbuttons, 'Clear parts', self._on_parts_clear)
		sigbox.Add(partbuttons, 0, wx.EXPAND|wx.ALL, 2)

		self.partclb = wx.CheckListBox(panel, -1, choices=[], size=(-1, 130))
		self.partclb.Bind(wx.EVT_CHECKLISTBOX, self._on_selection_changed)
		sigbox.Add(self.partclb, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 2)
		mvsizer.Add(sigbox, 0, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 4)

		panel.SetSizer(mvsizer)
		panel.FitInside()


	def _build_right_panel(self, panel):
		mvsizer = wx.BoxSizer(wx.VERTICAL)

		topsizer = wx.BoxSizer(wx.HORIZONTAL)
		topsizer.Add(wx.StaticText(panel, -1, 'From'), 0, wx.ALIGN_CENTER_VERTICAL|wx.RIGHT, 4)
		self.fromdate = wx.adv.DatePickerCtrl(panel, style=wx.adv.DP_DROPDOWN|wx.adv.DP_SHOWCENTURY)
		topsizer.Add(self.fromdate, 0, wx.RIGHT, 8)
		topsizer.Add(wx.StaticText(panel, -1, 'To'), 0, wx.ALIGN_CENTER_VERTICAL|wx.RIGHT, 4)
		self.todate = wx.adv.DatePickerCtrl(panel, style=wx.adv.DP_DROPDOWN|wx.adv.DP_SHOWCENTURY)
		topsizer.Add(self.todate, 0, wx.RIGHT, 12)
		topsizer.Add((1, 1), 1)

		self.searchbtn = wx.Button(panel, -1, mtexts.txts.get('Search', 'Search'))
		self.searchbtn.Bind(wx.EVT_BUTTON, self._on_search)
		topsizer.Add(self.searchbtn, 0, wx.RIGHT, 6)

		self.clearresultsbtn = wx.Button(panel, -1, 'Clear')
		self.clearresultsbtn.Bind(wx.EVT_BUTTON, self._on_clear_results)
		topsizer.Add(self.clearresultsbtn, 0)
		self.fromdate.Bind(wx.adv.EVT_DATE_CHANGED, self._on_selection_changed)
		self.todate.Bind(wx.adv.EVT_DATE_CHANGED, self._on_selection_changed)

		mvsizer.Add(topsizer, 0, wx.EXPAND|wx.ALL, 4)

		style = wx.LC_REPORT
		self.resultslist = wx.ListCtrl(panel, -1, style=style)
		self.resultslist.InsertColumn(0, '', width=62)
		self.resultslist.InsertColumn(1, 'Date', width=92)
		self.resultslist.InsertColumn(2, 'Time', width=72)
		self.resultslist.InsertColumn(3, 'Promittor', width=130)
		self.resultslist.InsertColumn(4, 'Significator', width=145)
		self.resultslist.InsertColumn(5, 'Technique', width=120)
		self.resultslist.Bind(wx.EVT_LIST_ITEM_SELECTED, self._on_result_selection_changed)
		self.resultslist.Bind(wx.EVT_LIST_ITEM_DESELECTED, self._on_result_selection_changed)
		self.resultslist.Bind(wx.EVT_LIST_ITEM_RIGHT_CLICK, self._on_results_context_menu)
		self.resultslist.Bind(wx.EVT_CONTEXT_MENU, self._on_results_context_menu)
		mvsizer.Add(self.resultslist, 1, wx.EXPAND|wx.LEFT|wx.RIGHT|wx.BOTTOM, 4)

		panel.SetSizer(mvsizer)


	def _render_aspect_bitmap(self, glyph, color):
		size = 18
		try:
			img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
			draw = ImageDraw.Draw(img)
			font = ImageFont.truetype(common.common.symbols, 14)
			w, h = draw.textsize(glyph, font)
			draw.text(((size-w)/2, (size-h)/2-1), glyph, fill=(color[0], color[1], color[2], 255), font=font)
			return wx.Bitmap.FromBufferRGBA(size, size, img.tobytes())
		except Exception:
			return wx.Bitmap(size, size)


	def _render_result_bitmap(self, row):
		width = 58
		height = 18
		try:
			img = Image.new('RGBA', (width, height), (255, 255, 255, 0))
			draw = ImageDraw.Draw(img)
			fnt_symbols = ImageFont.truetype(common.common.symbols, 14)
			fnt_text = ImageFont.truetype(common.common.abc, 9)
			x = 2
			prom = self.catalog.get(row.promittor_id)
			sig = self.catalog.get(row.significator_id)

			x = self._draw_object_glyph(draw, x, height, prom, fnt_symbols, fnt_text)
			x += 2
			aspect_idx = searchbackend.ASPECT_INDEX_BY_ID.get(row.aspect, chart.Chart.CONJUNCTIO)
			aspect_glyph = common.common.Aspects[aspect_idx]
			aspect_color = self.options.clraspect[aspect_idx]
			w, h = draw.textsize(aspect_glyph, fnt_symbols)
			draw.text((x, (height-h)/2-1), aspect_glyph, fill=(aspect_color[0], aspect_color[1], aspect_color[2], 255), font=fnt_symbols)
			x += w + 2
			self._draw_object_glyph(draw, x, height, sig, fnt_symbols, fnt_text)
			return wx.Bitmap.FromBufferRGBA(width, height, img.tobytes())
		except Exception:
			return wx.Bitmap(width, height)


	def _draw_object_glyph(self, draw, x, height, obj, fnt_symbols, fnt_text):
		if obj is None:
			return x

		glyph = self._object_glyph(obj)
		if glyph:
			color = self._object_color(obj)
			w, h = draw.textsize(glyph, fnt_symbols)
			draw.text((x, (height-h)/2-1), glyph, fill=(color[0], color[1], color[2], 255), font=fnt_symbols)
			return x + w

		short_label = obj.label
		if obj.id == 'angle:asc':
			short_label = 'Asc'
		elif obj.id == 'angle:mc':
			short_label = 'MC'
		elif len(short_label) > 3:
			short_label = short_label[:3]
		w, h = draw.textsize(short_label, fnt_text)
		draw.text((x, (height-h)/2), short_label, fill=(0, 0, 0, 255), font=fnt_text)
		return x + w


	def _object_glyph(self, obj):
		if obj.planet_index is not None and obj.planet_index < len(common.common.Planets):
			return common.common.Planets[obj.planet_index]
		if obj.id == 'point:lof':
			return common.common.fortune
		return None


	def _object_color(self, obj):
		palette = (
			self.options.clrdomicil,
			self.options.clrexal,
			self.options.clrperegrin,
			self.options.clrcasus,
			self.options.clrexil,
		)

		if obj.id == 'point:lof':
			if self.options.useplanetcolors:
				return self.options.clrindividual[astrology.SE_PLUTO+2]
			return self.options.clrtexts

		if obj.family == searchcatalog.SearchObject.FAMILY_NODE:
			return self.options.clrindividual[astrology.SE_PLUTO+1]

		if obj.planet_index is not None:
			if self.options.useplanetcolors:
				return self.options.clrindividual[obj.planet_index]
			if obj.planet_index < astrology.SE_PLUTO+1:
				return palette[self.chart.dignity(obj.planet_index)]
			return self.options.clrindividual[obj.planet_index]

		return self.options.clrtexts


	def _apply_compact_font(self):
		basefont = self.GetFont()
		pointsize = max(8, basefont.GetPointSize()-1)
		self.compactfont = wx.Font(pointsize, basefont.GetFamily(), basefont.GetStyle(), wx.FONTWEIGHT_NORMAL, False, basefont.GetFaceName())
		self._apply_font_recursive(self, self.compactfont)


	def _apply_font_recursive(self, win, font):
		try:
			win.SetFont(font)
		except Exception:
			pass

		for child in win.GetChildren():
			self._apply_font_recursive(child, font)


	def _add_button(self, parent, sizer, label, handler):
		btn = wx.Button(parent, -1, label)
		btn.Bind(wx.EVT_BUTTON, handler)
		sizer.Add(btn, 1, wx.RIGHT, 4)
		return btn


	def _apply_defaults(self):
		default_techniques = (
			searchquery.SearchQuery.TECHNIQUE_TRANSITS,
			searchquery.SearchQuery.TECHNIQUE_PROFECTIONS,
		)
		default_aspects = (searchquery.SearchQuery.ASPECT_CONJUNCTION,)
		saved_techniques = [tech for tech in getattr(self.options, 'search_techniques', []) if tech != searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS]
		saved_aspects = [aspect for aspect in getattr(self.options, 'search_aspects', []) if aspect in self.aspectbuttons]
		saved_promittors = [oid for oid in getattr(self.options, 'search_promittor_ids', []) if oid in self.catalog.objects_by_id]
		saved_significators = [oid for oid in getattr(self.options, 'search_significator_ids', []) if oid in self.catalog.objects_by_id]

		self.query.set_techniques(saved_techniques or default_techniques)
		self.query.set_aspects(saved_aspects or default_aspects)
		self.query.set_promittor_ids(saved_promittors or self.promittor_ids)
		self.query.set_significator_ids(saved_significators or self.builtin_significator_ids)

		today = datetime.date.today()
		next_year = today + datetime.timedelta(days=365)
		from_date = self._tuple_to_date(getattr(self.options, 'search_from', ())) or today
		to_date = self._tuple_to_date(getattr(self.options, 'search_to', ())) or next_year
		self.fromdate.SetValue(self._python_date_to_wx(from_date))
		self.todate.SetValue(self._python_date_to_wx(to_date))
		self.partfilter.ChangeValue(getattr(self.options, 'search_part_filter', ''))


	def _sync_all_controls_from_query(self):
		self._set_checked_states(self.promittorclb, self.promittor_ids, self.query.promittor_ids)
		self._set_checked_states(self.significatorclb, self.builtin_significator_ids, self.query.significator_ids)
		self._refresh_parts_list()
		self.transitsckb.SetValue(searchquery.SearchQuery.TECHNIQUE_TRANSITS in self.query.techniques)
		self.profectionsckb.SetValue(searchquery.SearchQuery.TECHNIQUE_PROFECTIONS in self.query.techniques)
		self.primarydirsckb.SetValue(searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS in self.query.techniques)
		for aspect_id, btn in self.aspectbuttons.items():
			btn.SetValue(aspect_id in self.query.aspects)


	def _refresh_parts_list(self):
		filter_text = self.partfilter.GetValue().strip().lower()
		self.filtered_part_ids = []
		filtered_labels = []

		for oid in self.part_ids:
			obj = self.catalog.get(oid)
			if obj is None:
				continue
			if filter_text and filter_text not in obj.label.lower():
				continue
			self.filtered_part_ids.append(oid)
			filtered_labels.append(obj.label)

		self.partclb.Set(filtered_labels)
		self._set_checked_states(self.partclb, self.filtered_part_ids, self.query.significator_ids)
		self.partclb.Enable(len(self.filtered_part_ids) != 0)


	def _refresh_selection_summary(self):
		self._sync_query_from_controls()
		return


	def _sync_query_from_controls(self):
		techniques = []
		if self.transitsckb.GetValue():
			techniques.append(searchquery.SearchQuery.TECHNIQUE_TRANSITS)
		if self.profectionsckb.GetValue():
			techniques.append(searchquery.SearchQuery.TECHNIQUE_PROFECTIONS)
		if self.primarydirsckb.GetValue():
			techniques.append(searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS)
		self.query.set_techniques(techniques)

		aspects = []
		for aspect_id, btn in self.aspectbuttons.items():
			if btn.GetValue():
				aspects.append(aspect_id)
		self.query.set_aspects(aspects)

		self.query.set_promittor_ids(self._get_checked_ids(self.promittorclb, self.promittor_ids))

		selected_builtin = self._get_checked_ids(self.significatorclb, self.builtin_significator_ids)
		selected_visible_parts = self._get_checked_ids(self.partclb, self.filtered_part_ids)
		selected_hidden_parts = [oid for oid in self.query.significator_ids if oid in self.part_ids and oid not in self.filtered_part_ids]
		selected_parts = self._ordered_subset(self.part_ids, selected_hidden_parts + selected_visible_parts)
		self.query.set_significator_ids(self._ordered_subset(self.builtin_significator_ids, selected_builtin) + selected_parts)


	def _ordered_subset(self, order_ids, selected_ids):
		selected_set = set(selected_ids)
		return [oid for oid in order_ids if oid in selected_set]


	def _set_checked_states(self, checklist, ids, selected_ids):
		selected_set = set(selected_ids)
		for idx, oid in enumerate(ids):
			checklist.Check(idx, oid in selected_set)


	def _get_checked_ids(self, checklist, ids):
		selected = []
		for idx, oid in enumerate(ids):
			if checklist.IsChecked(idx):
				selected.append(oid)
		return selected


	def _clear_results(self, message):
		self.results = []
		self.resultslist.DeleteAllItems()
		return


	def _fill_results_list(self):
		self.resultslist.DeleteAllItems()
		self.resultimagelist = wx.ImageList(58, 18)
		image_indexes = []
		for row in self.results:
			image_indexes.append(self.resultimagelist.Add(self._render_result_bitmap(row)))
		self.resultslist.AssignImageList(self.resultimagelist, wx.IMAGE_LIST_SMALL)

		for idx, row in enumerate(self.results):
			item_index = self.resultslist.InsertItem(idx, '', image_indexes[idx])
			self.resultslist.SetItem(item_index, 1, row.event_date or '--')
			self.resultslist.SetItem(item_index, 2, row.event_time or '--')
			self.resultslist.SetItem(item_index, 3, row.promittor_label)
			self.resultslist.SetItem(item_index, 4, row.significator_label)
			self.resultslist.SetItem(item_index, 5, self.technique_labels.get(row.technique, row.technique))


	def _get_selected_indexes(self):
		indexes = []
		index = self.resultslist.GetNextItem(-1, wx.LIST_NEXT_ALL, wx.LIST_STATE_SELECTED)
		while index != -1:
			indexes.append(index)
			index = self.resultslist.GetNextItem(index, wx.LIST_NEXT_ALL, wx.LIST_STATE_SELECTED)
		return indexes


	def _get_selected_results(self):
		rows = []
		for index in self._get_selected_indexes():
			if index < len(self.results):
				rows.append(self.results[index])
		return rows


	def _can_open_selected_chart(self):
		selected = self._get_selected_results()
		return len(selected) == 1 and selected[0].can_open_chart


	def _can_export_selected_ics(self):
		selected = self._get_selected_results()
		if len(selected) == 0:
			return False
		for row in selected:
			if not row.can_export_ics:
				return False
		return True


	def _can_copy_selected_time(self):
		selected = self._get_selected_results()
		if len(selected) == 0:
			return False
		for row in selected:
			if not row.can_export_time:
				return False
		return True


	def _show_action_not_ready(self, title, message):
		dlg = wx.MessageDialog(self, message, title, wx.OK|wx.ICON_INFORMATION)
		dlg.ShowModal()
		dlg.Destroy()


	def _python_date_to_wx(self, value):
		return wx.DateTime.FromDMY(value.day, value.month-1, value.year)


	def _wx_date_to_python(self, value):
		if not value.IsValid():
			return None
		return datetime.date(value.GetYear(), value.GetMonth()+1, value.GetDay())


	def _tuple_to_date(self, value):
		try:
			if len(value) == 3:
				return datetime.date(value[0], value[1], value[2])
		except Exception:
			pass
		return None


	def _persist_state(self):
		self._sync_query_from_controls()
		self.options.search_techniques = self.query.techniques[:]
		self.options.search_aspects = self.query.aspects[:]
		self.options.search_promittor_ids = self.query.promittor_ids[:]
		self.options.search_significator_ids = self.query.significator_ids[:]
		self.options.search_part_filter = self.partfilter.GetValue()

		from_date = self._wx_date_to_python(self.fromdate.GetValue())
		to_date = self._wx_date_to_python(self.todate.GetValue())
		self.options.search_from = (from_date.year, from_date.month, from_date.day) if from_date is not None else ()
		self.options.search_to = (to_date.year, to_date.month, to_date.day) if to_date is not None else ()

		try:
			self.mainfr.moptions.Enable(self.mainfr.ID_SaveOpts, True)
		except Exception:
			pass

		if getattr(self.options, 'autosave', False):
			try:
				self.options.saveSearch()
			except Exception:
				pass


	def _show_results_context_menu(self, screen_pos=None):
		menu = wx.Menu()
		id_select_all = wx.NewId()
		id_open_chart = wx.NewId()
		id_copy_time = wx.NewId()
		id_export_ics = wx.NewId()

		menu.Append(id_select_all, mtexts.txts.get('SelectAll', 'Select All'))
		menu.AppendSeparator()
		open_item = menu.Append(id_open_chart, 'Open Chart')
		copy_item = menu.Append(id_copy_time, 'Copy Time/Date')
		export_item = menu.Append(id_export_ics, 'Export Selected to ICS')

		open_item.Enable(self._can_open_selected_chart())
		copy_item.Enable(self._can_copy_selected_time())
		export_item.Enable(self._can_export_selected_ics())

		self.Bind(wx.EVT_MENU, self._on_select_all_results, id=id_select_all)
		self.Bind(wx.EVT_MENU, self._on_open_selected_chart, id=id_open_chart)
		self.Bind(wx.EVT_MENU, self._on_copy_selected_time, id=id_copy_time)
		self.Bind(wx.EVT_MENU, self._on_export_selected_ics, id=id_export_ics)

		pos = wx.DefaultPosition
		if screen_pos is not None and screen_pos != wx.DefaultPosition:
			try:
				pos = self.resultslist.ScreenToClient(screen_pos)
			except Exception:
				pos = wx.DefaultPosition

		self.resultslist.PopupMenu(menu, pos)
		menu.Destroy()


	def _select_promittors(self, ids):
		self.query.set_promittor_ids(ids)
		self._set_checked_states(self.promittorclb, self.promittor_ids, ids)
		self._on_selection_changed(None)


	def _select_builtin_significators(self, ids):
		current_parts = [oid for oid in self.query.significator_ids if oid in self.part_ids]
		self.query.set_significator_ids(self._ordered_subset(self.builtin_significator_ids, ids) + current_parts)
		self._set_checked_states(self.significatorclb, self.builtin_significator_ids, ids)
		self._refresh_parts_list()
		self._on_selection_changed(None)


	def _select_all_parts(self, selected):
		current_builtin = [oid for oid in self.query.significator_ids if oid in self.builtin_significator_ids]
		if selected:
			part_ids = self.part_ids[:]
		else:
			part_ids = []
		self.query.set_significator_ids(current_builtin + part_ids)
		self._refresh_parts_list()
		self._on_selection_changed(None)


	def _planetary_promittor_ids(self):
		ids = []
		for oid in self.promittor_ids:
			obj = self.catalog.get(oid)
			if obj is None:
				continue
			if obj.family in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE):
				ids.append(oid)
		return ids


	def _classical_promittor_ids(self):
		order = (
			'planet:sun',
			'planet:moon',
			'planet:mercury',
			'planet:venus',
			'planet:mars',
			'planet:jupiter',
			'planet:saturn',
		)
		return [oid for oid in order if oid in self.catalog.objects_by_id]


	def _planetary_significator_ids(self):
		ids = []
		for oid in self.builtin_significator_ids:
			obj = self.catalog.get(oid)
			if obj is None:
				continue
			if obj.family in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE):
				ids.append(oid)
		return ids


	def _on_selection_changed(self, event):
		self._refresh_selection_summary()
		self._persist_state()
		self._clear_results('')


	def _on_part_filter(self, event):
		self._refresh_parts_list()
		self._refresh_selection_summary()
		self._persist_state()
		self._clear_results('')


	def _on_search(self, event):
		self._refresh_selection_summary()
		if self.query.get_combination_count() == 0:
			self._clear_results('')
			return
		start_date = self._wx_date_to_python(self.fromdate.GetValue())
		end_date = self._wx_date_to_python(self.todate.GetValue())
		if start_date is None or end_date is None or start_date > end_date:
			self._clear_results('')
			return

		wx.BeginBusyCursor()
		try:
			self.results, truncated = searchbackend.search(self.catalog, self.chart, self.query, start_date, end_date, SearchWnd.RESULT_LIMIT)
		finally:
			if wx.IsBusy():
				wx.EndBusyCursor()
		self._fill_results_list()
		return


	def _on_clear_results(self, event):
		self._clear_results('')


	def _on_result_selection_changed(self, event):
		return


	def _on_results_context_menu(self, event):
		screen_pos = None
		try:
			screen_pos = event.GetPosition()
		except Exception:
			screen_pos = None
		self._show_results_context_menu(screen_pos)


	def _on_select_all_results(self, event):
		for idx in range(len(self.results)):
			self.resultslist.SetItemState(idx, wx.LIST_STATE_SELECTED, wx.LIST_STATE_SELECTED)


	def _on_open_selected_chart(self, event):
		selected = self._get_selected_results()
		if len(selected) != 1:
			return

		row = selected[0]
		if row.technique == searchquery.SearchQuery.TECHNIQUE_TRANSITS:
			self._open_transit_chart(row)
		elif row.technique == searchquery.SearchQuery.TECHNIQUE_PROFECTIONS:
			self._open_profection_chart(row)


	def _on_copy_selected_time(self, event):
		selected = self._get_selected_results()
		if len(selected) == 0:
			return
		text = searchbackend.build_clipboard_text(selected)
		if wx.TheClipboard.Open():
			try:
				wx.TheClipboard.SetData(wx.TextDataObject(text))
			finally:
				wx.TheClipboard.Close()


	def _on_export_selected_ics(self, event):
		selected = self._get_selected_results()
		if len(selected) == 0:
			return

		dlg = wx.FileDialog(self, 'Export ICS', '', 'search.ics', 'ICS files (*.ics)|*.ics', wx.FD_SAVE|wx.FD_OVERWRITE_PROMPT)
		if dlg.ShowModal() == wx.ID_OK:
			f = open(dlg.GetPath(), 'w')
			try:
				f.write(searchbackend.build_ics(selected))
			finally:
				f.close()
		dlg.Destroy()


	def _on_promittors_all(self, event):
		self._select_promittors(self.promittor_ids)


	def _on_promittors_planets(self, event):
		self._select_promittors(self._planetary_promittor_ids())


	def _on_promittors_core(self, event):
		self._select_promittors(self._classical_promittor_ids())


	def _on_promittors_clear(self, event):
		self._select_promittors([])


	def _on_significators_all_builtin(self, event):
		self._select_builtin_significators(self.builtin_significator_ids)


	def _on_significators_planets(self, event):
		self._select_builtin_significators(self._planetary_significator_ids())


	def _on_significators_clear_builtin(self, event):
		self._select_builtin_significators([])


	def _on_parts_all(self, event):
		self._select_all_parts(True)


	def _on_parts_clear(self, event):
		self._select_all_parts(False)


	def _build_event_time(self, row):
		return chart.Time(
			row.event_year, row.event_month, row.event_day,
			row.event_hour, row.event_minute, row.event_second,
			False, self.chart.time.cal, chart.Time.GREENWICH,
			True, 0, 0, False, self.chart.place, False
		)


	def _open_transit_chart(self, row):
		time = self._build_event_time(row)
		trans = chart.Chart(self.chart.name, self.chart.male, time, self.chart.place, chart.Chart.TRANSIT, '', self.options, False)
		title = self.mainfr.title.replace(
			mtexts.typeList[self.chart.htype],
			mtexts.typeList[chart.Chart.TRANSIT]+' ('+str(time.year)+'.'+common.common.months[time.month-1]+'.'+str(time.day)+' '+str(time.hour)+':'+str(time.minute).zfill(2)+':'+str(time.second).zfill(2)+')'
		)
		tw = transitframe.TransitFrame(self.mainfr, title, trans, self.chart, self.options, transitframe.TransitFrame.COMPOUND)
		tw.navigation_title_label = mtexts.typeList[chart.Chart.TRANSIT]
		tw.Show(True)


	def _open_profection_chart(self, row):
		t = row.event_hour + row.event_minute/60.0 + row.event_second/3600.0
		prof = profections.Profections(self.chart, row.event_year, row.event_month, row.event_day, t)
		pchart = chart.Chart(self.chart.name, self.chart.male, self.chart.time, self.chart.place, chart.Chart.PROFECTION, '', self.options, False, chart.Chart.YEAR)
		pchart.calcProfPos(prof)
		title = self.mainfr.title.replace(
			mtexts.typeList[self.chart.htype],
			mtexts.txts['Profections']+' ('+str(row.event_year)+'.'+str(row.event_month)+'.'+str(row.event_day)+' '+str(row.event_hour).zfill(2)+':'+str(row.event_minute).zfill(2)+':'+str(row.event_second).zfill(2)+')'
		)
		pf = profectionsframe.ProfectionsFrame(self.mainfr, title, pchart, self.chart, self.options, (row.event_year, row.event_month, row.event_day, row.event_hour, row.event_minute, row.event_second))
		pf.Show(True)

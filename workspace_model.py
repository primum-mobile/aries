# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from dataclasses import dataclass

import mtexts
import shortcut_registry


_UNSET = object()


@dataclass(frozen=True)
class WorkspaceAction:
	action_id: str
	label: str
	subtitle: str = ''
	shortcut: str = ''


@dataclass(frozen=True)
class WorkspaceSection:
	title: str
	items: tuple
	collapsed: bool = False


@dataclass(frozen=True)
class WorkspaceDocument:
	document_id: str
	kind: str
	title: str
	subtitle: str = ''
	path: str = ''
	parent_document_id: str = None
	indent_level: int = 0


@dataclass(frozen=True)
class WorkspaceSidebarState:
	top_actions: tuple
	documents: tuple
	active_document_id: str
	sections: tuple
	enabled_actions: dict


def _action_shortcut(action_id, menu_key=None, fallback=''):
	return shortcut_registry.workspace_shortcut(action_id, menu_key=menu_key, fallback=fallback)


DEFAULT_TOP_ACTIONS = (
	WorkspaceAction('new_chart', 'New', shortcut=_action_shortcut('new_chart', 'HMNew')),
	WorkspaceAction('open_chart', 'Open', shortcut=_action_shortcut('open_chart', 'HMLoad')),
	WorkspaceAction('here_and_now', 'Here and Now', shortcut=_action_shortcut('here_and_now', 'HMHereAndNow')),
)


DEFAULT_SECTIONS = (
	WorkspaceSection(
		title='Charts',
		items=(
			WorkspaceAction('synastry', 'Synastry', shortcut=_action_shortcut('synastry', 'HMSynastry')),
			WorkspaceAction('transits', 'Transits', shortcut=_action_shortcut('transits', 'PMTransits')),
			WorkspaceAction('solar_return', 'Solar Revolution', shortcut=_action_shortcut('solar_return', fallback='R')),
			WorkspaceAction('lunar_return', 'Lunar Revolution', shortcut=_action_shortcut('lunar_return', fallback='L')),
			WorkspaceAction('planetary_return', 'Planetary Return', shortcut=_action_shortcut('planetary_return')),
			WorkspaceAction('secondary_chart', 'Secondary Progression', shortcut=_action_shortcut('secondary_chart', 'PMSecondaryDirs')),
			WorkspaceAction('solar_arc_chart', 'Solar Arc', shortcut=_action_shortcut('solar_arc_chart', fallback='A')),
			WorkspaceAction('minor_chart', 'Minor Progression', shortcut=_action_shortcut('minor_chart', fallback='M')),
			WorkspaceAction('tertiary_chart', 'Tertiary Progression'),
			WorkspaceAction('primary_directions', 'Primary Directions', shortcut=_action_shortcut('primary_directions', 'TMPrimaryDirs')),
			WorkspaceAction('profections_chart', 'Profections', shortcut=_action_shortcut('profections_chart', fallback='P')),
			WorkspaceAction('harmonic_chart', 'Harmonic chart'),
			WorkspaceAction('astrolabe', 'Astrolabe', shortcut=''),
			WorkspaceAction('astrolog_sphere', 'Astrolog Sphere', shortcut=''),
			WorkspaceAction('astrocart', 'Astrocartography', shortcut=_action_shortcut('astrocart')),
		),
	),
	WorkspaceSection(
		title='Tables',
		items=(
			WorkspaceAction('calendar', 'calendar'),
			WorkspaceAction('temporal_confluence', 'temporal_confluence'),
			WorkspaceAction('positions', 'Positions', shortcut=_action_shortcut('positions', 'TMPositions')),
			WorkspaceAction('lunar_mansions', mtexts.txts.get('LunarMansions', 'Lunar Mansions...').rstrip('. …')),
			WorkspaceAction('aspects', 'Aspects', shortcut=_action_shortcut('aspects', 'TMAspects')),
			WorkspaceAction('aspect_list', 'aspect_list', shortcut=_action_shortcut('aspect_list')),
			WorkspaceAction('dodecatemoria', 'Dodecatemoria', shortcut=_action_shortcut('dodecatemoria', 'TMDodecatemoria')),
			WorkspaceAction('midpoints', 'Midpoints', shortcut=_action_shortcut('midpoints', 'TMMidpoints')),
			WorkspaceAction('asteroids', 'Asteroids'),
			WorkspaceAction('mundane_positions', 'Mundane Positions', shortcut=_action_shortcut('mundane_positions', 'TMMunPos')),
			WorkspaceAction('antiscia', 'Antiscia', shortcut=_action_shortcut('antiscia', 'TMAntiscia')),
			WorkspaceAction('zodpars', 'Zod. Pars', shortcut=_action_shortcut('zodpars', 'TMZodPars')),
			WorkspaceAction('arabic_parts', 'Arabic Parts', shortcut=_action_shortcut('arabic_parts', 'TMArabianParts')),
			WorkspaceAction('planetary_hours', 'Planetary Hours', shortcut=_action_shortcut('planetary_hours', 'TMPlanetaryHours')),
			WorkspaceAction('almuten_zodiacal', 'Almuten Zodiacal', shortcut=_action_shortcut('almuten_zodiacal', 'TMAlmutenZodiacal')),
			WorkspaceAction('almuten_chart', 'Almuten Chart', shortcut=_action_shortcut('almuten_chart', 'TMAlmutenChart')),
			WorkspaceAction('ephemeris', 'Graphic Ephemeris', shortcut=_action_shortcut('ephemeris', 'HMEphemeris')),
			WorkspaceAction('synodic_cycles', 'Synodic Cycles', shortcut=_action_shortcut('synodic_cycles')),
			WorkspaceAction('speeds', 'Planetary Speeds', shortcut=_action_shortcut('speeds', 'TMSpeeds')),
			WorkspaceAction('strip', 'Strip', shortcut=_action_shortcut('strip', 'TMStrip')),
			WorkspaceAction('exact_transits', 'Monthly Transits', shortcut=_action_shortcut('exact_transits', 'TMExactTransits')),
			WorkspaceAction('profections_table', 'Profections', shortcut=_action_shortcut('profections_table', 'TMProfections')),
			WorkspaceAction('rise_set', 'Rise / Set', shortcut=_action_shortcut('rise_set', 'TMRiseSet')),
			WorkspaceAction('angle_at_birth', 'Angle at Birth', shortcut=_action_shortcut('angle_at_birth', 'TMAngleAtBirth')),
			WorkspaceAction('phasis', 'Phasis', shortcut=_action_shortcut('phasis', 'TMPhasis')),
			WorkspaceAction('paranatellonta', 'Paranatellonta', shortcut=_action_shortcut('paranatellonta', 'TMParanatellonta')),
			WorkspaceAction('fixed_stars', 'Fixed Stars', shortcut=_action_shortcut('fixed_stars', 'TMFixStars')),
			WorkspaceAction('fixed_stars_aspects', 'Fixed Stars Aspects', shortcut=_action_shortcut('fixed_stars_aspects', 'TMFixStarsAsps')),
			WorkspaceAction('fixed_stars_parallels', 'Fixed Stars Parallels', shortcut=_action_shortcut('fixed_stars_parallels', 'TMFixStarsParallels')),
			WorkspaceAction('eclipses', 'Eclipses', shortcut=_action_shortcut('eclipses', 'TMEclipses')),
			WorkspaceAction('misc', 'Miscellaneous', shortcut=_action_shortcut('misc', 'TMMisc')),
		),
	),
	WorkspaceSection(
		title='Time Lords',
		items=(
			WorkspaceAction('vimshottari', mtexts.txts.get('VimshottariDasha', 'Vimshottari Dasha')),
			WorkspaceAction('firdaria', 'Firdaria', shortcut=_action_shortcut('firdaria', 'TMFirdaria')),
			WorkspaceAction('circumambulation', 'Circumambulations', shortcut=_action_shortcut('circumambulation', 'TMCircumambulation')),
			WorkspaceAction('zodiacal_releasing', 'Zodiacal Releasing', shortcut=_action_shortcut('zodiacal_releasing', 'TMZodiacalReleasing')),
			WorkspaceAction('decennials', 'Decennials', shortcut=_action_shortcut('decennials', 'TMDecennials')),
		),
	),
	WorkspaceSection(
		title='Research',
		items=(
			WorkspaceAction('triplicity_directions', 'Triplicity Directions'),
			WorkspaceAction('solar_average', 'Solar Average'),
		),
	),
)


class WorkspaceState(object):
	def __init__(self):
		self.reset()

	def _document_depth(self, parent_document_id):
		depth = 0
		seen = set()
		current_parent_id = parent_document_id
		while current_parent_id is not None and current_parent_id not in seen:
			seen.add(current_parent_id)
			parent_document = self.find_document(current_parent_id)
			if parent_document is None:
				break
			depth += 1
			current_parent_id = parent_document.parent_document_id
		return depth

	def _clone_document(self, document, title=None, subtitle=None, path=None, parent_document_id=_UNSET):
		next_parent_document_id = document.parent_document_id if parent_document_id is _UNSET else parent_document_id
		return WorkspaceDocument(
			document_id=document.document_id,
			kind=document.kind,
			title=document.title if title is None else title,
			subtitle=document.subtitle if subtitle is None else subtitle,
			path=document.path if path is None else path,
			parent_document_id=next_parent_document_id,
			indent_level=self._document_depth(next_parent_document_id),
		)

	def _normalize_document_indents(self):
		self._documents = [
			self._clone_document(document)
			for document in self._documents
		]

	def _document_index(self, document_id):
		for i, document in enumerate(self._documents):
			if document.document_id == document_id:
				return i
		return None

	def _root_document_ids(self):
		return [doc.document_id for doc in self._documents if doc.parent_document_id is None]

	def _attach_target_document_ids(self, document_id):
		blocked_ids = set(self._descendant_document_ids(document_id))
		blocked_ids.add(document_id)
		return [
			doc.document_id for doc in self._documents
			if doc.document_id not in blocked_ids
		]

	def _sibling_document_ids(self, document_id):
		document = self.find_document(document_id)
		if document is None:
			return []
		parent_document_id = document.parent_document_id
		return [
			doc.document_id for doc in self._documents
			if doc.parent_document_id == parent_document_id
		]

	def _descendant_document_ids(self, document_id):
		descendants = []
		queue = [document_id]
		while queue:
			current_parent_id = queue.pop(0)
			for document in self._documents:
				if document.parent_document_id != current_parent_id:
					continue
				if document.document_id in descendants:
					continue
				descendants.append(document.document_id)
				queue.append(document.document_id)
		return descendants

	def reset(self):
		self._documents = []
		self._active_document_id = None
		self._sequence = 0

	def open_document(self, kind, title, subtitle='', path='', parent_document_id=None, indent_level=0, insert_index=None):
		self._sequence += 1
		document = WorkspaceDocument(
			document_id='page-%d' % self._sequence,
			kind=kind,
			title=title,
			subtitle=subtitle,
			path=path,
			parent_document_id=parent_document_id,
			indent_level=self._document_depth(parent_document_id),
		)
		if insert_index is None:
			self._documents.append(document)
		else:
			index = max(0, min(int(insert_index), len(self._documents)))
			self._documents.insert(index, document)
		self._active_document_id = document.document_id
		return document

	def activate_document(self, document_id):
		if self.find_document(document_id) is not None:
			self._active_document_id = document_id

	def close_document(self, document_id):
		index = -1
		for i, document in enumerate(self._documents):
			if document.document_id == document_id:
				index = i
				break
		if index < 0:
			return None

		was_active = (self._active_document_id == document_id)
		del self._documents[index]

		if not self._documents:
			self._active_document_id = None
			return None

		if not was_active:
			return self._active_document_id

		next_index = min(index, len(self._documents) - 1)
		self._active_document_id = self._documents[next_index].document_id
		return self._active_document_id

	def find_document(self, document_id):
		for document in self._documents:
			if document.document_id == document_id:
				return document
		return None

	def update_document(self, document_id, title=None, subtitle=None, path=None, indent_level=None):
		for i, document in enumerate(self._documents):
			if document.document_id != document_id:
				continue
			next_title = document.title if title is None else title
			next_subtitle = document.subtitle if subtitle is None else subtitle
			next_path = document.path if path is None else path
			if (
				next_title == document.title and
				next_subtitle == document.subtitle and
				next_path == document.path
			):
				return document
			self._documents[i] = self._clone_document(
				document,
				title=title,
				subtitle=subtitle,
				path=path,
			)
			return self._documents[i]
		return None

	def _family_block(self, index):
		"""Return (start, end+1) of a document and all its descendants."""
		document_id = self._documents[index].document_id
		family_ids = set(self._descendant_document_ids(document_id))
		family_ids.add(document_id)
		end = index + 1
		while end < len(self._documents) and self._documents[end].document_id in family_ids:
			end += 1
		return index, end

	def _family_documents(self, document_id):
		family_ids = set(self._descendant_document_ids(document_id))
		family_ids.add(document_id)
		return [
			document for document in self._documents
			if document.document_id in family_ids
		]

	def _remove_family_documents(self, document_id):
		family = self._family_documents(document_id)
		if not family:
			return []
		family_ids = {document.document_id for document in family}
		self._documents = [
			document for document in self._documents
			if document.document_id not in family_ids
		]
		return family

	def sibling_list_indices(self, document_id):
		"""Return list indices of all siblings sharing the same explicit parent."""
		src_index = self._document_index(document_id)
		if src_index is None:
			return []
		parent_document_id = self._documents[src_index].parent_document_id
		return [
			i for i, document in enumerate(self._documents)
			if document.parent_document_id == parent_document_id
		]

	def move_document(self, document_id, before_document_id):
		"""Move document (with descendants) so it appears before before_document_id.
		If before_document_id is None, move to end of sibling group."""
		src_index = None
		for i, doc in enumerate(self._documents):
			if doc.document_id == document_id:
				src_index = i
				break
		if src_index is None:
			return False

		source_document = self._documents[src_index]
		siblings = self.sibling_list_indices(document_id)
		if len(siblings) < 2:
			return False

		family = self._remove_family_documents(document_id)
		if not family:
			return False

		if before_document_id is None:
			# move to end of sibling group
			sibling_ids = [
				doc.document_id for doc in self._documents
				if doc.parent_document_id == source_document.parent_document_id
			]
			if not sibling_ids:
				return False
			last_sib_id = sibling_ids[-1]
			if last_sib_id == document_id:
				return False
			last_family = self._family_documents(last_sib_id)
			if not last_family:
				return False
			insert_after = self._document_index(last_family[-1].document_id)
			if insert_after is None:
				return False
			insert_after += 1
		else:
			target_index = self._document_index(before_document_id)
			if target_index is None or before_document_id == document_id:
				return False
			if self._documents[target_index].parent_document_id != source_document.parent_document_id:
				return False
			insert_after = target_index

		# insert family at the target position
		for offset, doc in enumerate(family):
			self._documents.insert(insert_after + offset, doc)
		self._normalize_document_indents()
		return True

	def reparent_document(self, document_id, parent_document_id):
		"""Move document (with descendants) under parent_document_id as last child."""
		src_index = self._document_index(document_id)
		target_index = self._document_index(parent_document_id)
		if src_index is None or target_index is None or src_index == target_index:
			return False

		target_family_ids = set(self._descendant_document_ids(document_id))
		target_family_ids.add(document_id)
		if parent_document_id in target_family_ids:
			return False

		family = self._remove_family_documents(document_id)
		if not family:
			return False

		adjusted_family = list(family)
		adjusted_family[0] = self._clone_document(family[0], parent_document_id=parent_document_id)

		target_family = self._family_documents(parent_document_id)
		if not target_family:
			return False
		insert_at = self._document_index(target_family[-1].document_id)
		if insert_at is None:
			return False
		insert_at += 1

		for offset, doc in enumerate(adjusted_family):
			self._documents.insert(insert_at + offset, doc)
		self._normalize_document_indents()
		return True

	def detach_document_to_root(self, document_id, before_document_id=None):
		"""Move document (with descendants) to root level before before_document_id."""
		src_index = self._document_index(document_id)
		if src_index is None:
			return False

		family = self._remove_family_documents(document_id)
		if not family:
			return False

		if family[0].parent_document_id is None:
			for offset, doc in enumerate(family):
				self._documents.insert(src_index + offset, doc)
			return False

		target_index = None
		if before_document_id is not None:
			target_index = self._document_index(before_document_id)
			if target_index is None or before_document_id == document_id:
				return False
			if self._documents[target_index].parent_document_id is not None:
				return False

		adjusted_family = list(family)
		adjusted_family[0] = self._clone_document(family[0], parent_document_id=None)

		insert_at = len(self._documents) if target_index is None else target_index

		for offset, doc in enumerate(adjusted_family):
			self._documents.insert(insert_at + offset, doc)
		self._normalize_document_indents()
		return True

	def documents(self):
		return tuple(self._documents)

	def descendant_document_ids(self, document_id):
		return tuple(self._descendant_document_ids(document_id))

	def drag_context(self, document_id, allow_attach=False):
		document = self.find_document(document_id)
		if document is None:
			return {
				'ordered_ids': [],
				'sibling_ids': [],
				'root_ids': [],
				'hover_target_ids': [],
				'attach_target_ids': [],
			}
		sibling_ids = self._sibling_document_ids(document_id)
		root_ids = self._root_document_ids()
		attach_target_ids = self._attach_target_document_ids(document_id)
		hover_target_ids = list(attach_target_ids)
		return {
			'ordered_ids': [doc.document_id for doc in self._documents],
			'sibling_ids': sibling_ids,
			'root_ids': root_ids,
			'hover_target_ids': hover_target_ids,
			'attach_target_ids': attach_target_ids,
		}

	def resolve_drag_intent(self, document_id, hover_document_id=None, sibling_before_document_id=None, root_before_document_id=None, allow_attach=False, prefer_attach=False):
		document = self.find_document(document_id)
		if document is None:
			return None
		sibling_ids = self._sibling_document_ids(document_id)
		attach_target_ids = self._attach_target_document_ids(document_id)

		if prefer_attach and hover_document_id in attach_target_ids:
			return {
				'kind': 'attach',
				'target_document_id': hover_document_id,
				'before_document_id': None,
				'indicator_scope': None,
			}

		if hover_document_id in sibling_ids or (document.parent_document_id is None and hover_document_id is None):
			if len(sibling_ids) < 2 and sibling_before_document_id is None:
				return None
			return {
				'kind': 'reorder',
				'target_document_id': None,
				'before_document_id': sibling_before_document_id,
				'indicator_scope': 'siblings',
			}

		if document.parent_document_id is not None:
			return {
				'kind': 'detach',
				'target_document_id': None,
				'before_document_id': root_before_document_id,
				'indicator_scope': 'roots',
			}

		return None

	def active_document_id(self):
		return self._active_document_id

	def build_sidebar_state(self, enabled_actions, sections=None, top_actions=None):
		if sections is None:
			sections = DEFAULT_SECTIONS
		if top_actions is None:
			top_actions = DEFAULT_TOP_ACTIONS
		return WorkspaceSidebarState(
			top_actions=tuple(top_actions),
			documents=self.documents(),
			active_document_id=self._active_document_id,
			sections=tuple(sections),
			enabled_actions=dict(enabled_actions),
		)

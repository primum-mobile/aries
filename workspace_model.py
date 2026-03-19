from dataclasses import dataclass


@dataclass(frozen=True)
class WorkspaceAction:
	action_id: str
	label: str
	subtitle: str = ''


@dataclass(frozen=True)
class WorkspaceSection:
	title: str
	items: tuple


@dataclass(frozen=True)
class WorkspaceDocument:
	document_id: str
	kind: str
	title: str
	subtitle: str = ''
	path: str = ''
	indent_level: int = 0


@dataclass(frozen=True)
class WorkspaceSidebarState:
	documents: tuple
	active_document_id: str
	sections: tuple
	enabled_actions: dict


DEFAULT_SECTIONS = (
	WorkspaceSection(
		title='Horoscope',
		items=(
			WorkspaceAction('new_chart', 'New Chart'),
			WorkspaceAction('open_chart', 'Open Horoscope...'),
			WorkspaceAction('here_and_now', 'Here and Now'),
			WorkspaceAction('synastry', 'Synastry'),
		),
	),
	WorkspaceSection(
		title='Charts',
		items=(
			WorkspaceAction('transits', 'Transits'),
			WorkspaceAction('solar_return', 'Solar Revolution'),
			WorkspaceAction('lunar_return', 'Lunar Revolution'),
			WorkspaceAction('secondary_chart', 'Secondary Directions'),
			WorkspaceAction('profections_chart', 'Profections Chart'),
			WorkspaceAction('eclipses', 'Eclipses'),
			WorkspaceAction('angle_at_birth', 'Angle at Birth'),
		),
	),
	WorkspaceSection(
		title='Tables',
		items=(
			WorkspaceAction('misc', 'Miscellaneous'),
			WorkspaceAction('positions', 'Positions'),
			WorkspaceAction('midpoints', 'Midpoints'),
			WorkspaceAction('aspects', 'Aspects'),
			WorkspaceAction('rise_set', 'Rise / Set'),
			WorkspaceAction('speeds', 'Planetary Speeds'),
			WorkspaceAction('mundane_positions', 'Mundane Positions'),
			WorkspaceAction('antiscia', 'Antiscia'),
			WorkspaceAction('zodpars', 'Zod. Pars'),
			WorkspaceAction('strip', 'Strip'),
			WorkspaceAction('almuten_zodiacal', 'Almuten Zodiacal'),
			WorkspaceAction('almuten_chart', 'Almuten Chart'),
			WorkspaceAction('fixed_stars', 'Fixed Stars'),
			WorkspaceAction('fixed_stars_aspects', 'Fixed Stars Aspects'),
			WorkspaceAction('fixed_stars_parallels', 'Fixed Stars Parallels'),
			WorkspaceAction('exact_transits', 'Exact Transits'),
			WorkspaceAction('profections_table', 'Profections'),
			WorkspaceAction('primary_directions', 'Primary Directions'),
			WorkspaceAction('planetary_hours', 'Planetary Hours'),
			WorkspaceAction('arabic_parts', 'Arabic Parts'),
		),
	),
	WorkspaceSection(
		title='Time Lords',
		items=(
			WorkspaceAction('firdaria', 'Firdaria'),
			WorkspaceAction('circumambulation', 'Circumambulations'),
			WorkspaceAction('zodiacal_releasing', 'Zodiacal Releasing'),
			WorkspaceAction('decennials', 'Decennials'),
			WorkspaceAction('phasis', 'Phasis'),
			WorkspaceAction('paranatellonta', 'Paranatellonta'),
		),
	),
)


class WorkspaceState(object):
	def __init__(self):
		self.reset()

	def reset(self):
		self._documents = []
		self._active_document_id = None
		self._sequence = 0

	def open_document(self, kind, title, subtitle='', path='', indent_level=0, insert_index=None):
		self._sequence += 1
		document = WorkspaceDocument(
			document_id='page-%d' % self._sequence,
			kind=kind,
			title=title,
			subtitle=subtitle,
			path=path,
			indent_level=max(0, int(indent_level)),
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
			self._documents[i] = WorkspaceDocument(
				document_id=document.document_id,
				kind=document.kind,
				title=document.title if title is None else title,
				subtitle=document.subtitle if subtitle is None else subtitle,
				path=document.path if path is None else path,
				indent_level=document.indent_level if indent_level is None else max(0, int(indent_level)),
			)
			return self._documents[i]
		return None

	def _family_block(self, index):
		"""Return (start, end+1) of a document and all its descendants."""
		indent = self._documents[index].indent_level
		end = index + 1
		while end < len(self._documents) and self._documents[end].indent_level > indent:
			end += 1
		return index, end

	def sibling_list_indices(self, document_id):
		"""Return list indices of all siblings (same indent, same parent group) for the given document."""
		src_index = None
		for i, doc in enumerate(self._documents):
			if doc.document_id == document_id:
				src_index = i
				break
		if src_index is None:
			return []
		indent = self._documents[src_index].indent_level
		# find parent boundary (first doc above with lower indent, or start of list)
		parent_start = src_index
		while parent_start > 0:
			if self._documents[parent_start - 1].indent_level < indent:
				break
			parent_start -= 1
		# find parent boundary end (next doc at or below parent indent)
		parent_end = src_index + 1
		while parent_end < len(self._documents):
			if self._documents[parent_end].indent_level < indent:
				break
			parent_end += 1
		# collect siblings at the same indent level within the parent range
		return [i for i in range(parent_start, parent_end) if self._documents[i].indent_level == indent]

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

		indent = self._documents[src_index].indent_level
		siblings = self.sibling_list_indices(document_id)
		if len(siblings) < 2:
			return False

		src_block_start, src_block_end = self._family_block(src_index)
		family = self._documents[src_block_start:src_block_end]

		if before_document_id is None:
			# move to end of sibling group
			last_sib = siblings[-1]
			if last_sib == src_index:
				return False
			_, insert_after = self._family_block(last_sib)
		else:
			target_index = None
			for i, doc in enumerate(self._documents):
				if doc.document_id == before_document_id:
					target_index = i
					break
			if target_index is None or target_index == src_index:
				return False
			if target_index not in siblings:
				return False
			insert_after = target_index

		# remove the family block
		del self._documents[src_block_start:src_block_end]
		# adjust insertion point for the removal
		block_len = src_block_end - src_block_start
		if insert_after > src_block_start:
			insert_after -= block_len
		# insert family at the target position
		for offset, doc in enumerate(family):
			self._documents.insert(insert_after + offset, doc)
		return True

	def documents(self):
		return tuple(self._documents)

	def active_document_id(self):
		return self._active_document_id

	def build_sidebar_state(self, enabled_actions, sections=None):
		if sections is None:
			sections = DEFAULT_SECTIONS
		return WorkspaceSidebarState(
			documents=self.documents(),
			active_document_id=self._active_document_id,
			sections=tuple(sections),
			enabled_actions=dict(enabled_actions),
		)

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
			WorkspaceAction('secondary_chart', 'Secondary Directions'),
			WorkspaceAction('profections_chart', 'Profections Chart'),
		),
	),
	WorkspaceSection(
		title='Tables',
		items=(
			WorkspaceAction('positions', 'Positions'),
			WorkspaceAction('aspects', 'Aspects'),
			WorkspaceAction('rise_set', 'Rise / Set'),
			WorkspaceAction('exact_transits', 'Exact Transits'),
			WorkspaceAction('profections_table', 'Profections'),
			WorkspaceAction('primary_directions', 'Primary Directions'),
			WorkspaceAction('planetary_hours', 'Planetary Hours'),
			WorkspaceAction('firdaria', 'Firdaria'),
			WorkspaceAction('arabic_parts', 'Arabic Parts'),
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

	def open_document(self, kind, title, subtitle='', path=''):
		self._sequence += 1
		document = WorkspaceDocument(
			document_id='page-%d' % self._sequence,
			kind=kind,
			title=title,
			subtitle=subtitle,
			path=path,
		)
		self._documents.append(document)
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

	def update_document(self, document_id, title=None, subtitle=None, path=None):
		for i, document in enumerate(self._documents):
			if document.document_id != document_id:
				continue
			self._documents[i] = WorkspaceDocument(
				document_id=document.document_id,
				kind=document.kind,
				title=document.title if title is None else title,
				subtitle=document.subtitle if subtitle is None else subtitle,
				path=document.path if path is None else path,
			)
			return self._documents[i]
		return None

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

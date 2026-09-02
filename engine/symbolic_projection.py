# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import campanianpd
import circumambulation
import placidiansapd
import placidianutppd
import primdirs
import regiomontanpd


PRIMARY_DIRECTIONS = 'primary_directions'
CIRCUMAMBULATION = 'circumambulation'


def binding_table_state(binding=None):
	if not isinstance(binding, dict):
		return {}
	return dict(binding.get('table_state') or {})


def binding_apply_state(binding=None, wrapper_key=None):
	state = binding_table_state(binding)
	if not state:
		return None
	if wrapper_key is None:
		return state
	return {wrapper_key: state}


def projection_table_state(projection=None):
	if not isinstance(projection, dict):
		return {}
	return dict(projection.get('table_state') or {})


def projection_apply_state(projection=None, wrapper_key=None):
	state = None
	if isinstance(projection, dict):
		popup_state = projection.get('popup_restore_state')
		restore_state = projection.get('restore_state')
		if wrapper_key is not None and isinstance(popup_state, dict):
			state = dict(popup_state)
		elif isinstance(restore_state, dict):
			state = dict(restore_state)
	if state is None:
		state = projection_table_state(projection)
	if not state:
		return None
	if wrapper_key is not None and isinstance(state, dict) and wrapper_key in state:
		return state
	if wrapper_key is None:
		return state
	return {wrapper_key: state}


def projection_content(projection=None):
	if not isinstance(projection, dict):
		return None
	if 'content' in projection:
		return projection.get('content')
	if 'rows' in projection:
		return projection.get('rows')
	if 'pds' in projection:
		return projection.get('pds')
	return None


def project_symbolic_table(feature_kind, chart_obj, options, binding=None, **kwargs):
	if feature_kind == PRIMARY_DIRECTIONS:
		projection = project_primary_directions(
			chart_obj,
			options,
			binding,
			kwargs.get('abort'),
			default_range=kwargs.get('default_range'),
			default_direction=kwargs.get('default_direction'),
		)
		return {
			'feature_kind': PRIMARY_DIRECTIONS,
			'content_kind': 'pds',
			'content': projection.get('pds'),
			'binding': projection.get('binding'),
			'table_state': projection.get('table_state'),
			'restore_state': projection.get('restore_state'),
			'popup_restore_state': projection.get('popup_restore_state'),
			'focus_resolution': {
				'resolved_index': projection.get('resolved_index'),
			},
			'native_projection': projection,
			'pd_options': projection.get('pd_options'),
		}
	if feature_kind == CIRCUMAMBULATION:
		projection = project_circumambulation(
			chart_obj,
			options,
			binding,
			default_key=kwargs.get('default_key', 1.0),
			default_max_age=kwargs.get('default_max_age', 150),
			default_include_participating=kwargs.get('default_include_participating', True),
			default_use_exact_oa=kwargs.get('default_use_exact_oa', False),
			custom_significator=kwargs.get('custom_significator'),
			natal_participator_chart=kwargs.get('natal_participator_chart'),
			promissor_profile=kwargs.get('promissor_profile'),
		)
		return {
			'feature_kind': CIRCUMAMBULATION,
			'content_kind': 'rows',
			'content': projection.get('rows'),
			'binding': projection.get('binding'),
			'table_state': projection.get('table_state'),
			'restore_state': projection.get('restore_state'),
			'popup_restore_state': projection.get('restore_state'),
			'focus_resolution': {
				'resolved_index': None,
			},
			'native_projection': projection,
		}
	raise ValueError('Unsupported symbolic table feature: %s' % feature_kind)


def normalize_primary_directions_binding(binding=None, default_range=None, default_direction=None, default_view_mode='workspace_table'):
	state = dict(binding or {})
	state['feature_kind'] = 'primary_directions'
	# When the caller passes an explicit default, treat it as an OVERRIDE rather
	# than a fallback. The cached binding may still hold the previous range/
	# direction from an earlier calc; honoring it would silently ignore the
	# user's latest filter click (Direct/Converse/Both, age range) and the
	# recompute would regress to the old mode.
	if default_range is not None:
		state['range_mode'] = int(default_range)
	else:
		state['range_mode'] = int(state.get('range_mode', primdirs.PrimDirs.RANGEALL))
	if default_direction is not None:
		state['direction_mode'] = int(default_direction)
	else:
		state['direction_mode'] = int(state.get('direction_mode', primdirs.PrimDirs.DIRECT))
	state['focus_mode'] = state.get('focus_mode', 'row_index')
	state['focus_signature'] = state.get('focus_signature')
	state['view_mode'] = state.get('view_mode', default_view_mode)
	state['table_state'] = dict(state.get('table_state') or {})
	return state


def primary_directions_binding_from_state(state=None, pdrange=None, direction=None, view_mode='workspace_table'):
	return normalize_primary_directions_binding(
		{
			'range_mode': pdrange,
			'direction_mode': direction,
			'focus_mode': 'pd_signature' if isinstance(state, dict) and state.get('pd_signature') is not None else 'row_index',
			'focus_signature': state.get('pd_signature') if isinstance(state, dict) else None,
			'view_mode': view_mode,
			'table_state': dict(state or {}),
		},
		default_range=pdrange,
		default_direction=direction,
		default_view_mode=view_mode,
	)


def primary_directions_binding_payload(pdrange=None, direction=None, table_state=None, view_mode='workspace_table'):
	state = dict(table_state or {})
	return normalize_primary_directions_binding(
		{
			'range_mode': pdrange,
			'direction_mode': direction,
			'focus_mode': 'pd_signature' if state.get('pd_signature') is not None else 'row_index',
			'focus_signature': state.get('pd_signature'),
			'view_mode': view_mode,
			'table_state': state,
		},
		default_range=pdrange,
		default_direction=direction,
		default_view_mode=view_mode,
	)


def normalize_circumambulation_binding(binding=None, default_key=1.0, default_max_age=150, default_include_participating=True, default_use_exact_oa=False, default_view_mode='workspace_table'):
	state = dict(binding or {})
	state['feature_kind'] = 'circumambulation'
	state['key_mode'] = float(state.get('key_mode', default_key))
	state['max_age_mode'] = int(state.get('max_age_mode', default_max_age))
	state['participation_mode'] = bool(state.get('participation_mode', default_include_participating))
	state['focus_mode'] = state.get('focus_mode', 'row_index')
	state['focus_signature'] = state.get('focus_signature')
	state['view_mode'] = state.get('view_mode', default_view_mode)
	state['use_exact_oa'] = bool(state.get('use_exact_oa', default_use_exact_oa))
	state['table_state'] = dict(state.get('table_state') or {})
	return state


def circumambulation_binding_from_state(state=None, key=1.0, max_age=150, include_participating=True, use_exact_oa=False, view_mode='workspace_table'):
	return normalize_circumambulation_binding(
		{
			'key_mode': key,
			'max_age_mode': max_age,
			'participation_mode': include_participating,
			'focus_mode': 'row_signature' if isinstance(state, dict) and state.get('focus_signature') is not None else 'row_index',
			'focus_signature': state.get('focus_signature') if isinstance(state, dict) else None,
			'view_mode': view_mode,
			'use_exact_oa': use_exact_oa,
			'table_state': dict(state or {}),
		},
		default_key=key,
		default_max_age=max_age,
		default_include_participating=include_participating,
		default_use_exact_oa=use_exact_oa,
		default_view_mode=view_mode,
	)


def circumambulation_binding_payload(table_state=None, key=1.0, max_age=150, include_participating=True, use_exact_oa=False, view_mode='workspace_table'):
	state = dict(table_state or {})
	return normalize_circumambulation_binding(
		{
			'key_mode': key,
			'max_age_mode': max_age,
			'participation_mode': include_participating,
			'focus_mode': 'row_signature' if state.get('focus_signature') is not None else 'row_index',
			'focus_signature': state.get('focus_signature'),
			'view_mode': view_mode,
			'use_exact_oa': use_exact_oa,
			'table_state': state,
		},
		default_key=key,
		default_max_age=max_age,
		default_include_participating=include_participating,
		default_use_exact_oa=use_exact_oa,
		default_view_mode=view_mode,
	)


def build_primary_directions(chart_obj, options, pdrange, direction, abort):
	pd_options = primdirs.PrimDirs.get_effective_revolution_options(chart_obj, options)
	if pd_options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC:
		pds = placidiansapd.PlacidianSAPD(chart_obj, pd_options, pdrange, direction, abort)
	elif pd_options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
		pds = placidianutppd.PlacidianUTPPD(chart_obj, pd_options, pdrange, direction, abort)
	elif pd_options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
		pds = regiomontanpd.RegiomontanPD(chart_obj, pd_options, pdrange, direction, abort)
	elif pd_options.primarydir == primdirs.PrimDirs.TOPOCENTRIC:
		import topocentricpd
		pds = topocentricpd.TopocentricPD(chart_obj, pd_options, pdrange, direction, abort)
	else:
		pds = campanianpd.CampanianPD(chart_obj, pd_options, pdrange, direction, abort)
	return pds, pd_options


def build_circumambulation_rows(chart_obj, options, key, max_rows=60, include_participating=True, max_age_years=150, use_exact_oa=False, custom_significator=None, natal_participator_chart=None, promissor_profile=None):
	return circumambulation.compute_distributions(
		chart_obj,
		options,
		key=key,
		max_rows=max_rows,
		include_participating=include_participating,
		max_age_years=max_age_years,
		use_exact_oa=use_exact_oa,
		custom_significator=custom_significator,
		natal_participator_chart=natal_participator_chart,
		promissor_profile=promissor_profile,
	)


def project_circumambulation(chart_obj, options, binding, default_key=1.0, default_max_age=150, default_include_participating=True, default_use_exact_oa=False, custom_significator=None, natal_participator_chart=None, promissor_profile=None):
	effective_binding = normalize_circumambulation_binding(
		binding,
		default_key=default_key,
		default_max_age=default_max_age,
		default_include_participating=default_include_participating,
		default_use_exact_oa=default_use_exact_oa,
		default_view_mode=(binding or {}).get('view_mode', 'workspace_table') if isinstance(binding, dict) else 'workspace_table',
	)
	rows = build_circumambulation_rows(
		chart_obj,
		options,
		key=effective_binding['key_mode'],
		max_rows=max(60, int(float(effective_binding['max_age_mode']) * 2)),
		include_participating=effective_binding['participation_mode'],
		max_age_years=effective_binding['max_age_mode'],
		use_exact_oa=effective_binding['use_exact_oa'],
		custom_significator=custom_significator,
		natal_participator_chart=natal_participator_chart,
		promissor_profile=promissor_profile,
	)
	state = dict(effective_binding.get('table_state') or {})
	if effective_binding.get('focus_signature') is not None and state.get('focus_signature') is None:
		state['focus_signature'] = effective_binding.get('focus_signature')
	effective_binding['table_state'] = state
	return {
		'rows': rows,
		'content': rows,
		'binding': effective_binding,
		'table_state': dict(state),
		'restore_state': dict(state),
	}


def pd_entry_signature(pd):
	if pd is None:
		return None
	try:
		return (
			int(getattr(pd, 'prom', -1)),
			int(getattr(pd, 'prom2', -1)),
			int(getattr(pd, 'promasp', -1)),
			int(getattr(pd, 'sig', -1)),
			int(getattr(pd, 'sigasp', -1)),
			bool(getattr(pd, 'direct', False)),
			bool(getattr(pd, 'mundane', False)),
			int(getattr(pd, 'parallelaxis', -1)),
			round(float(getattr(pd, 'arc', 0.0)), 8),
			round(float(getattr(pd, 'time', 0.0)), 8),
			round(float(getattr(pd, 'promasp_offset', 0.0)), 8),
			round(float(getattr(pd, 'sigasp_offset', 0.0)), 8),
			getattr(pd, 'promdyn', None),
			getattr(pd, 'sigdyn', None),
			getattr(pd, 'system', None),
			getattr(
				pd,
				'domain',
				'mundane' if bool(getattr(pd, 'mundane', False)) else 'zodiacal',
			),
			getattr(pd, 'event_kind', 'direction'),
		)
	except Exception:
		return None


def resolve_pd_index_from_state(entries, state):
	total = len(entries or [])
	if total <= 0:
		return None
	signature = state.get('pd_signature') if isinstance(state, dict) else None
	if signature is not None:
		best_idx = None
		best_key = None
		for idx, pd in enumerate(entries):
			sig = pd_entry_signature(pd)
			# Signatures are append-only.  An older retained binding may therefore
			# carry a valid prefix that predates the newer row provenance fields.
			try:
				stored_signature = tuple(signature)
			except TypeError:
				stored_signature = ()
			if sig == stored_signature or (
				sig is not None
				and stored_signature
				and len(stored_signature) < len(sig)
				and sig[:len(stored_signature)] == stored_signature
			):
				return idx
			try:
				key = (
					0 if bool(getattr(pd, 'direct', False)) == bool(signature[5]) else 1,
					abs(float(getattr(pd, 'time', 0.0)) - float(signature[9])),
					abs(float(getattr(pd, 'arc', 0.0)) - float(signature[8])),
				)
			except Exception:
				continue
			if best_key is None or key < best_key:
				best_key = key
				best_idx = idx
		if best_idx is not None:
			return best_idx
	if isinstance(state, dict):
		last_pdnum = state.get('last_pdnum')
		if isinstance(last_pdnum, int):
			if last_pdnum < 0:
				return 0
			if last_pdnum >= total:
				return total - 1
			return last_pdnum
	return 0


def project_primary_directions(chart_obj, options, binding, abort, default_range=None, default_direction=None):
	effective_binding = normalize_primary_directions_binding(
		binding,
		default_range=default_range,
		default_direction=default_direction,
		default_view_mode=(binding or {}).get('view_mode', 'workspace_table') if isinstance(binding, dict) else 'workspace_table',
	)
	pds, pd_options = build_primary_directions(
		chart_obj,
		options,
		effective_binding['range_mode'],
		effective_binding['direction_mode'],
		abort,
	)
	entries = getattr(pds, 'pds', []) or []
	if getattr(pd_options, 'pdmorinpromittorset', False):
		pds.pds = primdirs.filter_morin_promittor_set(entries)
		entries = pds.pds
	table_state = dict(effective_binding.get('table_state') or {})
	if effective_binding.get('focus_signature') is not None and table_state.get('pd_signature') is None:
		table_state['pd_signature'] = effective_binding.get('focus_signature')
	resolved_index = resolve_pd_index_from_state(entries, table_state)
	if resolved_index is not None and 0 <= resolved_index < len(entries):
		resolved_signature = pd_entry_signature(entries[resolved_index])
		table_state['last_pdnum'] = int(resolved_index)
		table_state['pd_signature'] = resolved_signature
		effective_binding['focus_mode'] = 'pd_signature'
		effective_binding['focus_signature'] = resolved_signature
	effective_binding['table_state'] = table_state
	return {
		'pds': pds,
		'content': pds,
		'pd_options': pd_options,
		'binding': effective_binding,
		'table_state': dict(table_state),
		'restore_state': dict(table_state),
		'popup_restore_state': {'table_state': dict(table_state)},
		'resolved_index': resolved_index,
	}

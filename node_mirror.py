"""One contact per aspect the lunar nodes share.

The North and South Node are always exactly opposite, so any body in aspect
to one is in the mirrored aspect to the other (conjunction/opposition,
trine/sextile, square/square, ...). Display surfaces list that contact once:
the conjunction wins, otherwise the North Node contact stays.

Presentation only: the engine and searches still see both nodes.
"""

import astrology

NORTH = astrology.SE_MEAN_NODE
SOUTH = astrology.SE_TRUE_NODE
NODES = (NORTH, SOUTH)
_CONJUNCTION = 0  # chart.Chart.CONJUNCTIO; not imported to keep this leaf-level


def redundant_node(south_aspect_type):
	"""The node whose contact is dropped when both nodes carry the mirror."""
	return NORTH if int(south_aspect_type) == _CONJUNCTION else SOUTH


def redundant_keys(contacts):
	"""Keys of the mirrored node contacts to drop.

	``contacts`` yields ``(key, partner, node_id, aspect_type)``: ``key``
	identifies the item, ``partner`` the other end (plus any chart role on the
	node side) so only the same body's pair is compared, ``node_id`` is
	NORTH or SOUTH."""
	groups = {}
	for key, partner, node_id, aspect_type in contacts:
		if node_id in NODES:
			groups.setdefault(partner, {})[node_id] = (key, aspect_type)
	drop = set()
	for hits in groups.values():
		if NORTH in hits and SOUTH in hits:
			drop.add(hits[redundant_node(hits[SOUTH][1])][0])
	return drop

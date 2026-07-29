# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from dataclasses import dataclass, field
import os
from typing import Any

import astrology


@dataclass(frozen=True, slots=True)
class EphemerisContext:
	"""Immutable Swiss Ephemeris configuration for one calculation."""

	flags: int
	ephe_path: str | None = None
	sidereal_mode: int | None = None
	topocentric_position: tuple[float, float, float] | None = None
	_allow_incomplete: bool = field(default=False, repr=False, compare=False)

	def __post_init__(self) -> None:
		flags = int(self.flags)
		object.__setattr__(self, "flags", flags)
		if self.ephe_path is not None:
			object.__setattr__(self, "ephe_path", os.path.abspath(os.fspath(self.ephe_path)))
		if self.sidereal_mode is not None:
			object.__setattr__(self, "sidereal_mode", int(self.sidereal_mode))
		if self.topocentric_position is not None:
			if len(self.topocentric_position) != 3:
				raise ValueError("topocentric_position must contain longitude, latitude, and altitude")
			object.__setattr__(
				self,
				"topocentric_position",
				tuple(float(value) for value in self.topocentric_position),
			)
		if not self._allow_incomplete:
			if not self.ephe_path:
				raise ValueError("EphemerisContext requires an absolute ephe_path")
			if flags & astrology.SEFLG_SIDEREAL and self.sidereal_mode is None:
				raise ValueError("sidereal flags require an explicit sidereal_mode")
			if flags & astrology.SEFLG_TOPOCTR and self.topocentric_position is None:
				raise ValueError("topocentric flags require an explicit topocentric_position")

	@property
	def is_complete(self) -> bool:
		if not self.ephe_path:
			return False
		if self.flags & astrology.SEFLG_SIDEREAL and self.sidereal_mode is None:
			return False
		if self.flags & astrology.SEFLG_TOPOCTR and self.topocentric_position is None:
			return False
		return True

	@property
	def is_native_compatible(self) -> bool:
		"""Whether the native engine has every state value required by the flags."""
		return self.is_complete

	@classmethod
	def for_chart(
		cls,
		chrt: Any,
		*,
		ephe_path: str | None = None,
		include_speed: bool = True,
		include_sidereal: bool = True,
		include_topocentric: bool = True,
		extra_flags: int = 0,
	) -> EphemerisContext:
		options = chrt.options
		flags = int(extra_flags) | astrology.SEFLG_SWIEPH
		if include_speed:
			flags |= astrology.SEFLG_SPEED

		sidereal_mode = None
		ayanamsha = int(getattr(options, "ayanamsha", 0) or 0)
		if include_sidereal and ayanamsha:
			sidereal_mode = astrology.ayanamsha_swe_mode(ayanamsha)
			flags |= astrology.SEFLG_SIDEREAL

		topocentric_position = None
		if include_topocentric and bool(getattr(options, "topocentric", False)):
			place = chrt.place
			topocentric_position = (
				float(place.lon),
				float(place.lat),
				float(place.altitude),
			)
			flags |= astrology.SEFLG_TOPOCTR

		return cls(
			flags=flags,
			ephe_path=ephe_path,
			sidereal_mode=sidereal_mode,
			topocentric_position=topocentric_position,
		)

	def activate(self):
		return astrology.swiss_context(
			self.ephe_path,
			self.sidereal_mode,
			self.topocentric_position,
		)

	def apply(self, backend: Any = astrology) -> None:
		if backend is astrology:
			with self.activate():
				return
		if self.ephe_path:
			backend.swe_set_ephe_path(self.ephe_path)
		if self.sidereal_mode is not None:
			backend.swe_set_sid_mode(self.sidereal_mode, 0.0, 0.0)
		if self.topocentric_position is not None:
			backend.swe_set_topo(*self.topocentric_position)

	@classmethod
	def legacy(
		cls,
		*,
		flags: int,
		ephe_path: str | None,
	) -> EphemerisContext:
		return cls(
			flags=int(flags),
			ephe_path=ephe_path,
			_allow_incomplete=True,
		)


def resolve_ephemeris_context(
	context: EphemerisContext | None,
	*,
	ephe_path: str | None,
	flags: int,
) -> EphemerisContext:
	if context is not None:
		if ephe_path is not None and os.path.abspath(os.fspath(ephe_path)) != context.ephe_path:
			raise ValueError("ephe_path conflicts with context.ephe_path")
		if int(flags) not in (0, context.flags):
			raise ValueError("flags conflict with context.flags")
		return context

	if ephe_path is None:
		import common

		ephe_path = common.get_ephe_path()
	return EphemerisContext.legacy(flags=int(flags), ephe_path=ephe_path)

# -*- coding: utf-8 -*-
from contextlib import contextmanager
from functools import lru_cache
import os
from threading import local, RLock

from sweastrology import *  # legacy: provides lots of names/constants used elsewhere
import sweastrology as _swe


_RAW_SWE_FUNCTIONS = getattr(_swe, "_aries_raw_swe_functions", None)
if _RAW_SWE_FUNCTIONS is None:
	_RAW_SWE_FUNCTIONS = {
		name: value
		for name, value in vars(_swe).items()
		if name.startswith("swe_") and callable(value)
	}
	setattr(_swe, "_aries_raw_swe_functions", _RAW_SWE_FUNCTIONS)
_SWISS_CONTEXT_LOCK = RLock()
_SWISS_THREAD_CONTEXT = local()
_SWISS_EPHE_PATH = None
_SWISS_SIDEREAL = None
_SWISS_TOPO = None


def _normalized_ephe_path(path):
	if path is None:
		return None
	return os.path.abspath(os.fspath(path))


def swe_set_ephe_path(path):
	global _SWISS_EPHE_PATH, _SWISS_SIDEREAL, _SWISS_TOPO
	normalized = _normalized_ephe_path(path)
	with _SWISS_CONTEXT_LOCK:
		_SWISS_THREAD_CONTEXT.ephe_path = normalized
		if normalized == _SWISS_EPHE_PATH:
			return
		_RAW_SWE_FUNCTIONS["swe_set_ephe_path"](normalized)
		_SWISS_EPHE_PATH = normalized
		# swe_set_ephe_path closes Swiss's cached files and calculation state.
		_SWISS_SIDEREAL = None
		_SWISS_TOPO = None


def swe_set_sid_mode(mode, t0=0.0, ayan_t0=0.0):
	global _SWISS_SIDEREAL
	value = (int(mode), float(t0), float(ayan_t0))
	with _SWISS_CONTEXT_LOCK:
		_SWISS_THREAD_CONTEXT.sidereal = value
		if value == _SWISS_SIDEREAL:
			return
		_RAW_SWE_FUNCTIONS["swe_set_sid_mode"](*value)
		_SWISS_SIDEREAL = value


def swe_set_topo(geolon, geolat, geoalt):
	global _SWISS_TOPO
	value = (float(geolon), float(geolat), float(geoalt))
	with _SWISS_CONTEXT_LOCK:
		_SWISS_THREAD_CONTEXT.topocentric = value
		if value == _SWISS_TOPO:
			return
		_RAW_SWE_FUNCTIONS["swe_set_topo"](*value)
		_SWISS_TOPO = value


def swe_close():
	global _SWISS_EPHE_PATH, _SWISS_SIDEREAL, _SWISS_TOPO
	with _SWISS_CONTEXT_LOCK:
		_RAW_SWE_FUNCTIONS["swe_close"]()
		_SWISS_EPHE_PATH = None
		_SWISS_SIDEREAL = None
		_SWISS_TOPO = None
		_SWISS_THREAD_CONTEXT.__dict__.clear()


@contextmanager
def swiss_context(ephe_path=None, sidereal_mode=None, topocentric_position=None):
	"""Activate one complete root-extension context for an atomic calculation."""
	with _SWISS_CONTEXT_LOCK:
		previous_thread_context = dict(_SWISS_THREAD_CONTEXT.__dict__)
		try:
			if ephe_path is not None:
				swe_set_ephe_path(ephe_path)
			if sidereal_mode is not None:
				swe_set_sid_mode(sidereal_mode, 0.0, 0.0)
			if topocentric_position is not None:
				swe_set_topo(*topocentric_position)
			yield
		finally:
			_SWISS_THREAD_CONTEXT.__dict__.clear()
			_SWISS_THREAD_CONTEXT.__dict__.update(previous_thread_context)
			_restore_thread_context_locked()


def _restore_thread_context_locked():
	global _SWISS_EPHE_PATH, _SWISS_SIDEREAL, _SWISS_TOPO
	ephe_path = getattr(_SWISS_THREAD_CONTEXT, "ephe_path", None)
	sidereal = getattr(_SWISS_THREAD_CONTEXT, "sidereal", None)
	topocentric = getattr(_SWISS_THREAD_CONTEXT, "topocentric", None)
	if ephe_path is not None and ephe_path != _SWISS_EPHE_PATH:
		_RAW_SWE_FUNCTIONS["swe_set_ephe_path"](ephe_path)
		_SWISS_EPHE_PATH = ephe_path
		_SWISS_SIDEREAL = None
		_SWISS_TOPO = None
	if sidereal is not None and sidereal != _SWISS_SIDEREAL:
		_RAW_SWE_FUNCTIONS["swe_set_sid_mode"](*sidereal)
		_SWISS_SIDEREAL = sidereal
	if topocentric is not None and topocentric != _SWISS_TOPO:
		_RAW_SWE_FUNCTIONS["swe_set_topo"](*topocentric)
		_SWISS_TOPO = topocentric


def _raw_swe_call(name, *args, **kwargs):
	with _SWISS_CONTEXT_LOCK:
		_restore_thread_context_locked()
		return _RAW_SWE_FUNCTIONS[name](*args, **kwargs)


def _unwrap_1tuple(v):
	"""Unwrap nested 1-element tuples (common in this project's sweastrology wrapper)."""
	while isinstance(v, tuple) and len(v) == 1:
		v = v[0]
	return v


def swe_calc_ex(tjd, ipl, iflag):
	"""Return (retflag, xx[0..5], serr)."""
	r = _raw_swe_call("swe_calc", tjd, ipl, iflag)
	if isinstance(r, tuple) and len(r) >= 3:
		retflag = _unwrap_1tuple(r[0])
		xx = r[1]
		serr = _unwrap_1tuple(r[2])
		return retflag, xx, serr
	# Fallback: best-effort
	return 0, (), ""


def swe_calc(tjd, ipl, iflag):
	"""Compatibility: return (serr, xx[0..5])."""
	_retflag, xx, serr = swe_calc_ex(tjd, ipl, iflag)
	return serr, xx


def swe_calc_ut_ex(tjd_ut, ipl, iflag):
	"""Return (retflag, xx[0..5], serr)."""
	r = _raw_swe_call("swe_calc_ut", tjd_ut, ipl, iflag)
	if isinstance(r, tuple) and len(r) >= 3:
		retflag = _unwrap_1tuple(r[0])
		xx = r[1]
		serr = _unwrap_1tuple(r[2])
		return retflag, xx, serr
	return 0, (), ""


def swe_calc_ut(tjd_ut, ipl, iflag):
	"""Compatibility: return (serr, xx[0..5])."""
	_retflag, xx, serr = swe_calc_ut_ex(tjd_ut, ipl, iflag)
	return serr, xx


def swe_houses_ex(tjd_ut, iflag, geolat, geolon, hsys):
	"""Return (res, cusps, ascmc) with `res` unwrapped to int."""
	r = _raw_swe_call("swe_houses_ex", tjd_ut, iflag, geolat, geolon, hsys)
	if isinstance(r, tuple) and len(r) >= 3:
		return _unwrap_1tuple(r[0]), r[1], r[2]
	return 0, (), ()


def swe_houses(tjd_ut, geolat, geolon, hsys):
	r = _raw_swe_call("swe_houses", tjd_ut, geolat, geolon, hsys)
	if isinstance(r, tuple) and len(r) >= 3:
		return _unwrap_1tuple(r[0]), r[1], r[2]
	return 0, (), ()


def swe_fixstar(star, tjd, iflag):
	"""Return (ret, xx[0..5], serr) with `ret` and `serr` unwrapped."""
	r = _raw_swe_call("swe_fixstar", star, tjd, iflag)
	if isinstance(r, tuple) and len(r) >= 3:
		return _unwrap_1tuple(r[0]), r[1], _unwrap_1tuple(r[2])
	return 0, (), ""


def swe_fixstar_ut(star, tjd_ut, iflag):
	"""
	Return (ret, name_tuple, xx[0..5], serr).
	Keep `name` as a 1-tuple to preserve legacy callers that use `name[0]`.
	"""
	r = _raw_swe_call("swe_fixstar_ut", star, tjd_ut, iflag)
	if isinstance(r, tuple) and len(r) >= 4:
		ret = _unwrap_1tuple(r[0])
		name = r[1]
		xx = r[2]
		serr = _unwrap_1tuple(r[3])
		return ret, name, xx, serr
	return 0, ("",), (), ""


def swe_fixstar_mag(star):
	"""
	Return (ret, name_tuple, mag_tuple_or_float, serr).
	Keep `name` as a 1-tuple for compatibility.
	"""
	r = _raw_swe_call("swe_fixstar_mag", star)
	if isinstance(r, tuple) and len(r) >= 4:
		ret = _unwrap_1tuple(r[0])
		name = r[1]
		mag = r[2]
		serr = _unwrap_1tuple(r[3])
		return ret, name, mag, serr
	return 0, ("",), (0.0,), ""


def swe_sol_eclipse_when_glob(tjd_start, ifl, ifltype, backward):
	"""Return (retflag, tret[0..9], serr) for the next/previous solar eclipse."""
	r = _raw_swe_call("swe_sol_eclipse_when_glob", tjd_start, ifl, ifltype, backward)
	if isinstance(r, tuple) and len(r) >= 3:
		return _unwrap_1tuple(r[0]), r[1], _unwrap_1tuple(r[2])
	return 0, (), ""


def swe_lun_eclipse_when(tjd_start, ifl, ifltype, backward):
	"""Return (retflag, tret[0..9], serr) for the next/previous lunar eclipse."""
	r = _raw_swe_call("swe_lun_eclipse_when", tjd_start, ifl, ifltype, backward)
	if isinstance(r, tuple) and len(r) >= 3:
		return _unwrap_1tuple(r[0]), r[1], _unwrap_1tuple(r[2])
	return 0, (), ""


def swe_get_ayanamsa(*args):
	return _raw_swe_call("swe_get_ayanamsa", *args)


def swe_get_ayanamsa_ut(*args):
	return _raw_swe_call("swe_get_ayanamsa_ut", *args)


def swe_heliacal_ut(*args):
	return _raw_swe_call("swe_heliacal_ut", *args)


def swe_lun_eclipse_how(*args):
	return _raw_swe_call("swe_lun_eclipse_how", *args)


def swe_pheno_ut(*args):
	return _raw_swe_call("swe_pheno_ut", *args)


def swe_rise_trans(*args):
	return _raw_swe_call("swe_rise_trans", *args)


def swe_sol_eclipse_where(*args):
	return _raw_swe_call("swe_sol_eclipse_where", *args)


def _locked_raw_swe_call(name):
	def call(*args, **kwargs):
		return _raw_swe_call(name, *args, **kwargs)

	call.__name__ = name
	call.__qualname__ = name
	return call


_CONTEXT_SETTER_NAMES = {
	"swe_close",
	"swe_set_ephe_path",
	"swe_set_sid_mode",
	"swe_set_topo",
}
_COMPATIBILITY_ADAPTER_NAMES = {
	"swe_calc",
	"swe_calc_ut",
	"swe_fixstar",
	"swe_fixstar_mag",
	"swe_fixstar_ut",
	"swe_get_ayanamsa",
	"swe_get_ayanamsa_ut",
	"swe_heliacal_ut",
	"swe_houses",
	"swe_houses_ex",
	"swe_lun_eclipse_how",
	"swe_lun_eclipse_when",
	"swe_pheno_ut",
	"swe_rise_trans",
	"swe_sol_eclipse_when_glob",
	"swe_sol_eclipse_where",
}
for _name in _RAW_SWE_FUNCTIONS:
	if _name in _CONTEXT_SETTER_NAMES:
		setattr(_swe, _name, globals()[_name])
		continue
	_locked_call = _locked_raw_swe_call(_name)
	setattr(_swe, _name, _locked_call)
	if _name not in _COMPATIBILITY_ADAPTER_NAMES:
		globals()[_name] = _locked_call

SE_JUL_CAL = 0
SE_GREG_CAL = 1

#planet numbers for the ipl parameter in swe_calc()
SE_ECL_NUT = -1      

SE_SUN = 0       
SE_MOON = 1       
SE_MERCURY = 2       
SE_VENUS = 3       
SE_MARS = 4       
SE_JUPITER = 5       
SE_SATURN = 6       
SE_URANUS = 7       
SE_NEPTUNE = 8       
SE_PLUTO = 9       
SE_MEAN_NODE = 10      
SE_TRUE_NODE = 11
SE_MEAN_APOG = 12      
SE_OSCU_APOG = 13    
SE_EARTH = 14      
SE_CHIRON = 15      
SE_PHOLUS = 16      
SE_CERES = 17      
SE_PALLAS = 18      
SE_JUNO = 19      
SE_VESTA = 20      
SE_INTP_APOG = 21      
SE_INTP_PERG = 22    

SE_NPLANETS = 23      

SE_AST_OFFSET = 10000
SE_VARUNA = (SE_AST_OFFSET + 20000)

SE_FICT_OFFSET = 40
SE_FICT_OFFSET_1 = 39
SE_FICT_MAX = 999 
SE_NFICT_ELEM = 15

SE_COMET_OFFSET = 1000

SE_NALL_NAT_POINTS = (SE_NPLANETS + SE_NFICT_ELEM)

# Hamburger or Uranian "planets"
SE_CUPIDO = 40
SE_HADES = 41
SE_ZEUS = 42
SE_KRONOS = 43
SE_APOLLON = 44
SE_ADMETOS = 45
SE_VULKANUS = 46
SE_POSEIDON = 47
# other fictitious bodies
SE_ISIS  = 48
SE_NIBIRU = 49
SE_HARRINGTON = 50
SE_NEPTUNE_LEVERRIER = 51
SE_NEPTUNE_ADAMS = 52
SE_PLUTO_LOWELL = 53
SE_PLUTO_PICKERING = 54
SE_VULCAN = 55
SE_WHITE_MOON = 56
SE_PROSERPINA = 57
SE_WALDEMATH = 58

SE_FIXSTAR = -10

SE_ASC = 0
SE_MC = 1
SE_ARMC = 2
SE_VERTEX = 3
SE_EQUASC = 4	# "equatorial ascendant"
SE_COASC1 = 5	# "co-ascendant" (W. Koch)
SE_COASC2 = 6	# "co-ascendant" (M. Munkasey)
SE_POLASC = 7	# "polar ascendant" (M. Munkasey)
SE_NASCMC = 8


# flag bits for parameter iflag in function swe_calc()
# The flag bits are defined in such a way that iflag = 0 delivers what one
# usually wants:
#    - the default ephemeris (SWISS EPHEMERIS) is used,
#    - apparent geocentric positions referring to the true equinox of date
#      are returned.
# If not only coordinates, but also speed values are required, use 
# flag = SEFLG_SPEED.
#
# The 'L' behind the number indicates that 32-bit integers (Long) are used.

SEFLG_JPLEPH = 1       # use JPL ephemeris
SEFLG_SWIEPH = 2       # use SWISSEPH ephemeris
SEFLG_MOSEPH = 4       # use Moshier ephemeris

SEFLG_HELCTR = 8  		# return heliocentric position
SEFLG_TRUEPOS = 16 		# return true positions, not apparent
SEFLG_J2000 = 32     		# no precession, i.e. give J2000 equinox
SEFLG_NONUT = 64     		# no nutation, i.e. mean equinox of date
SEFLG_SPEED3 = 128     # speed from 3 positions (do not use it, SEFLG_SPEED is faster and more precise.)
SEFLG_SPEED = 256     	# high precision speed
SEFLG_NOGDEFL = 512     # turn off gravitational deflection
SEFLG_NOABERR =1024    # turn off 'annual' aberration of light
SEFLG_EQUATORIAL = (2*1024)    # equatorial positions are wanted
SEFLG_XYZ = (4*1024)    # cartesian, not polar, coordinates
SEFLG_RADIANS = (8*1024)    # coordinates in radians, not degrees
SEFLG_BARYCTR = (16*1024)   # barycentric positions
SEFLG_TOPOCTR = (32*1024)   # topocentric positions
SEFLG_SIDEREAL = (64*1024)   # sidereal positions
SEFLG_ICRS = (128*1024)  # ICRS (DE406 reference frame)

SE_SIDBITS = 256
# for projection onto ecliptic of t0
SE_SIDBIT_ECL_T0 = 256
# for projection onto solar system plane 
SE_SIDBIT_SSY_PLANE = 512

# sidereal modes (ayanamsas)
SE_SIDM_FAGAN_BRADLEY    = 0
SE_SIDM_LAHIRI           = 1
SE_SIDM_DELUCE           = 2
SE_SIDM_RAMAN            = 3
SE_SIDM_USHASHASHI       = 4
SE_SIDM_KRISHNAMURTI     = 5
SE_SIDM_DJWHAL_KHUL      = 6
SE_SIDM_YUKTESHWAR       = 7
SE_SIDM_JN_BHASIN        = 8
SE_SIDM_BABYL_KUGLER1    = 9
SE_SIDM_BABYL_KUGLER2   = 10
SE_SIDM_BABYL_KUGLER3   = 11
SE_SIDM_BABYL_HUBER    	= 12
SE_SIDM_BABYL_ETPSC    	= 13
SE_SIDM_ALDEBARAN_15TAU = 14
SE_SIDM_HIPPARCHOS      = 15
SE_SIDM_SASSANIAN       = 16
SE_SIDM_GALCENT_0SAG    = 17
SE_SIDM_J2000           = 18
SE_SIDM_J1900           = 19
SE_SIDM_B1950           = 20
SE_SIDM_TRUE_CITRA      = 27   # Chitrapaksha — Spica (Citra) fixed at 0° Libra
SE_SIDM_GALCENT_RGILBRAND = 30
SE_SIDM_GALCENT_MULA_WILHELM = 36  # Dhruva / Galactic Center / Mula (Ernst Wilhelm)
SE_SIDM_USER            = 255

SE_NSIDM_PREDEF	  	    = 21


# ─────────────────────────────────────────────────────────────────────────
# Aries UI ayanamsha index → SwissEph SE_SIDM_* constant.
#
# Aries persists the user's chosen ayanamsha in ``options.ayanamsha`` as a
# 1-based index into ``mtexts.ayanamshalist`` (0 = tropical / no mode set).
# For positions 1..21 the SwissEph mode is simply ``index - 1`` — that
# legacy contract is preserved here. Newer entries can sit anywhere in the
# UI list and map to whatever SwissEph mode they need; the helper below
# is the single chokepoint every ``swe_set_sid_mode`` call site goes
# through, so adding an ayanamsha is "add the constant, add the label,
# add a row to this dict" and nothing else changes.
# ─────────────────────────────────────────────────────────────────────────
# Ordered by practitioner relevance (see CHANGELOG 2026-06-01 02:00).
# Tier 1 (1-3): the two dominant zodiac defaults + Lahiri's own corrected
# version. Tier 2 (4-10): popular Indian schools and a couple of Western
# sidereal alternatives. Tier 3 (11-13): modern Western fixed-point
# anchors. Tier 4 (14-18): Babylonian historical reconstructions.
# Tier 5 (19-20): ancient. Tier 6 (21-23): astronomical-epoch references
# rarely used in living astrological practice.
_AYANAMSHA_SWE_MODE_BY_UI_INDEX = {
	1:  SE_SIDM_FAGAN_BRADLEY,
	2:  SE_SIDM_LAHIRI,
	3:  SE_SIDM_TRUE_CITRA,
	4:  SE_SIDM_KRISHNAMURTI,
	5:  SE_SIDM_RAMAN,
	6:  SE_SIDM_YUKTESHWAR,
	7:  SE_SIDM_DELUCE,
	8:  SE_SIDM_JN_BHASIN,
	9:  SE_SIDM_USHASHASHI,
	10: SE_SIDM_DJWHAL_KHUL,
	11: SE_SIDM_GALCENT_0SAG,
	12: SE_SIDM_GALCENT_RGILBRAND,
	13: SE_SIDM_ALDEBARAN_15TAU,
	14: SE_SIDM_BABYL_KUGLER1,
	15: SE_SIDM_BABYL_KUGLER2,
	16: SE_SIDM_BABYL_KUGLER3,
	17: SE_SIDM_BABYL_HUBER,
	18: SE_SIDM_BABYL_ETPSC,
	19: SE_SIDM_HIPPARCHOS,
	20: SE_SIDM_SASSANIAN,
	21: SE_SIDM_J2000,
	22: SE_SIDM_J1900,
	23: SE_SIDM_B1950,
	24: SE_SIDM_GALCENT_MULA_WILHELM,
}


def ayanamsha_swe_mode(opt_index):
	"""Return the SwissEph SE_SIDM_* constant for an Aries UI ayanamsha
	index (``options.ayanamsha``). Returns ``None`` when the chart is
	tropical (index 0 or falsy). Unknown indices fall through to the
	legacy ``opt_index - 1`` sequential interpretation so old presets
	keep working even if the dict above misses them.
	"""
	try:
		idx = int(opt_index)
	except (TypeError, ValueError):
		return None
	if idx <= 0:
		return None
	return _AYANAMSHA_SWE_MODE_BY_UI_INDEX.get(idx, idx - 1)


@lru_cache(maxsize=8192)
def _effective_ayanamsha_ut_cached(tjd_ut, mode):
	swe_set_sid_mode(mode, 0, 0)
	base_flags = SEFLG_SWIEPH | SEFLG_SPEED
	_serr, tropical = swe_calc_ut(tjd_ut, SE_SUN, base_flags)
	_serr, sidereal = swe_calc_ut(tjd_ut, SE_SUN, base_flags | SEFLG_SIDEREAL)
	return (float(tropical[0]) - float(sidereal[0])) % 360.0


def effective_ayanamsha_ut(tjd_ut, opt_index):
	"""Return the exact longitude shift applied by ``SEFLG_SIDEREAL``.

	``swe_get_ayanamsa_ut()`` returns the conventional ayanamsha value, while
	Swiss Ephemeris' apparent ecliptic longitudes also include the current
	nutation convention.  The two differ by several arcseconds.  Aries needs
	the effective shift when recovering a chart-frame longitude for
	``swe_cotrans``; derive it from paired tropical/sidereal calculations so
	the conversion is the exact inverse of the boundary that produced the
	stored longitude.
	"""
	mode = ayanamsha_swe_mode(opt_index)
	if mode is None:
		return 0.0
	tjd_ut = float(tjd_ut)
	# Sidereal mode is process-global. Always restore the requested mode even
	# when the numerical offset itself is served from the cache.
	swe_set_sid_mode(mode, 0, 0)
	return _effective_ayanamsha_ut_cached(tjd_ut, mode)

# used for swe_nod_aps():
SE_NODBIT_MEAN		= 1   # mean nodes/apsides
SE_NODBIT_OSCU		= 2   # osculating nodes/apsides
SE_NODBIT_OSCU_BAR	= 4   # same, but motion about solar system barycenter is considered
SE_NODBIT_FOPOINT	= 256 # focal point of orbit instead of aphelion

# default ephemeris used when no ephemeris flagbit is set
SEFLG_DEFAULTEPH = SEFLG_SWIEPH

SE_MAX_STNAME		= 20	# maximum size of fixstar name; the parameter star in swe_fixstar must allow twice this space for the returned star name.

# defines for eclipse computations

SE_ECL_CENTRAL		= 1
SE_ECL_NONCENTRAL	= 2
SE_ECL_TOTAL		= 4
SE_ECL_ANNULAR		= 8
SE_ECL_PARTIAL		= 16
SE_ECL_ANNULAR_TOTAL	= 32
SE_ECL_PENUMBRAL	= 64
SE_ECL_ALLTYPES_SOLAR = (SE_ECL_CENTRAL|SE_ECL_NONCENTRAL|SE_ECL_TOTAL|SE_ECL_ANNULAR|SE_ECL_PARTIAL|SE_ECL_ANNULAR_TOTAL)
SE_ECL_ALLTYPES_LUNAR = (SE_ECL_TOTAL|SE_ECL_PARTIAL|SE_ECL_PENUMBRAL)
SE_ECL_VISIBLE		= 128
SE_ECL_MAX_VISIBLE	= 256
SE_ECL_1ST_VISIBLE	= 512
SE_ECL_2ND_VISIBLE	= 1024
SE_ECL_3RD_VISIBLE	= 2048
SE_ECL_4TH_VISIBLE	= 4096
SE_ECL_ONE_TRY		= (32*1024) 
# check if the next conjunction of the moon with a planet is an occultation; don't search further

# for swe_rise_transit()
SE_CALC_RISE		= 1
SE_CALC_SET			= 2
SE_CALC_MTRANSIT	= 4
SE_CALC_ITRANSIT	= 8
SE_BIT_DISC_CENTER  = 256 # to be or'ed to SE_CALC_RISE/SET if rise or set of disc center is required
SE_BIT_NO_REFRACTION = 512 # to be or'ed to SE_CALC_RISE/SET, if refraction is not to be considered
SE_BIT_CIVIL_TWILIGHT = 1024 # to be or'ed to SE_CALC_RISE/SET
SE_BIT_NAUTIC_TWILIGHT = 2048 # to be or'ed to SE_CALC_RISE/SET
SE_BIT_ASTRO_TWILIGHT  = 4096 # to be or'ed to SE_CALC_RISE/SET

# for swe_azalt() and swe_azalt_rev()
SE_ECL2HOR		= 0
SE_EQU2HOR		= 1
SE_HOR2ECL		= 0
SE_HOR2EQU		= 1

# for swe_refrac()
SE_TRUE_TO_APP	= 0
SE_APP_TO_TRUE	= 1


# only used for experimenting with various JPL ephemeris files which are available at Astrodienst's internal network

SE_DE_NUMBER    = 406
SE_FNAME_DE200  = "de200.eph"
SE_FNAME_DE403  = "de403.eph"
SE_FNAME_DE404  = "de404.eph"
SE_FNAME_DE405  = "de405.eph"
SE_FNAME_DE406  = "de406.eph"
SE_FNAME_DFT    = SE_FNAME_DE406
SE_STARFILE     = "sefstars.txt"
SE_STARFILE_FALLBACKS = ("sefstars.txt", "fixstars.cat", "fixedstars.cat")
SE_ASTNAMFILE   = "seasnam.txt"
SE_FICTFILE     = "seorbel.txt"
# ---- Preferred alias (display name) resolver for fixed stars -----------------
def ensure_fixstar_alias_loaded(options):
    """
    options.fixstarAliasMap 이 비어 있으면 ephepath의 JSON에서 한 번만 복구한다.
    쓰기는 하지 않는다(저장은 FixStarsDlg에서만).
    """
    try:
        if (options is None) or (hasattr(options, 'fixstarAliasMap') and isinstance(options.fixstarAliasMap, dict) and options.fixstarAliasMap):
            return
        # 지연 로드: common / os / json 은 함수 안에서 import (순환참조 방지)
        import os, json
        try:
            import common
            ephepath = getattr(common.common, 'ephepath', '')
        except Exception:
            ephepath = ''
        if not hasattr(options, 'fixstarAliasMap') or not isinstance(getattr(options, 'fixstarAliasMap', None), dict):
            options.fixstarAliasMap = {}
        alias_json = os.path.join(ephepath or os.getcwd(), 'fixstar_aliases.json')
        if os.path.isfile(alias_json):
            with open(alias_json, 'r') as _f:
                data = json.load(_f)
            if isinstance(data, dict):
                options.fixstarAliasMap.update({k: v for k, v in data.items() if isinstance(k, str)})
    except Exception:
        # 조용히 폴백
        pass


def display_fixstar_name(code, options, fallback_name=None):
    """
    고정별 '표시용 이름'을 결정한다.
      - 식별은 항상 code(nomname).
      - 1순위: options.fixstarAliasMap[code] (사용자 선호 별칭)
      - 2순위: fallback_name (호출자가 카탈로그명/Swiss명 등 전달하면 사용)
      - 3순위: code 그대로
    이 함수는 쓰기(저장)를 절대 하지 않으며, 비어 있을 때만 JSON을 게으르게 로드한다.
    """
    try:
        ensure_fixstar_alias_loaded(options)
        if options and hasattr(options, 'fixstarAliasMap') and isinstance(options.fixstarAliasMap, dict):
            disp = options.fixstarAliasMap.get(code)
            if disp:
                return disp
    except Exception:
        pass
    # 호출자가 제공한 카탈로그 기본명 우선 사용
    if fallback_name:
        return fallback_name
    # 마지막 폴백은 code
    return code
# ------------------------------------------------------------------------------

# ephemeris path
# this defines where ephemeris files are expected if the function
# swe_set_ephe_path() is not called by the application.
# Normally, every application should make this call to define its
# own place for the ephemeris files.
SE_EPHE_PATH    = ".:/users/ephe2/:/users/ephe/"
			# At Astrodienst, we maintain two ephemeris areas for the thousands of asteroid files: the short files in /users/ephe/ast*, the long file in /users/ephe2/ast*. 

# defines for function swe_split_deg() (in swephlib.c)
SE_SPLIT_DEG_ROUND_SEC = 1
SE_SPLIT_DEG_ROUND_MIN = 2
SE_SPLIT_DEG_ROUND_DEG = 4
SE_SPLIT_DEG_ZODIACAL = 8
SE_SPLIT_DEG_KEEP_SIGN = 16 # don't round to next sign, e.g. 29.9999999 will be rounded to 29d59m59s (or 29d59m or 29d)
SE_SPLIT_DEG_KEEP_DEG    = 32 # don't round to next degree e.g. 13.9999999 will be rounded to 13d59m59s (or 13d59m or 13d)

# for heliacal functions
SE_HELIACAL_RISING = 1
SE_HELIACAL_SETTING	= 2
SE_MORNING_FIRST = SE_HELIACAL_RISING
SE_EVENING_LAST = SE_HELIACAL_SETTING
SE_EVENING_FIRST = 3
SE_MORNING_LAST = 4
SE_ACRONYCHAL_RISING = 5 # still not implemented
SE_COSMICAL_SETTING	= 6 # still not implemented
SE_ACRONYCHAL_SETTING = SE_COSMICAL_SETTING

SE_HELFLAG_LONG_SEARCH = 128
SE_HELFLAG_HIGH_PRECISION =	256
SE_HELFLAG_OPTICAL_PARAMS =	512
SE_HELFLAG_NO_DETAILS =	1024
SE_HELFLAG_AVKIND_VR = 2048
SE_HELFLAG_AVKIND_PTO =	4096
SE_HELFLAG_AVKIND_MIN7 = 8192
SE_HELFLAG_AVKIND_MIN9 = 16384
SE_HELFLAG_AVKIND = (SE_HELFLAG_AVKIND_VR|SE_HELFLAG_AVKIND_PTO|SE_HELFLAG_AVKIND_MIN7|SE_HELFLAG_AVKIND_MIN9)
TJD_INVALID	= 99999999.0
SIMULATE_VICTORVB = 1

SE_PHOTOPIC_FLAG = 0
SE_SCOTOPIC_FLAG = 1
SE_MIXEDOPIC_FLAG =	2

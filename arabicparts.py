# -*- coding: utf-8 -*-
import json

import astrology
import houses
import planets
import fortune
import chart
import mtexts
import util
import math

class ArabicParts:
    '''Computes Arabic Parts'''

    NAME = 0
    FORMULA = 1
    DIURNAL = 2
    LONG = 3
    DEGWINNER = 4
    GENDERED = 5
    FEMALE_FORMULA = 6
    FEMALE_REFDEG = 7
    NOCTURNAL_FORMULA = 8
    NOCTURNAL_REFDEG = 9

    REFASC = 0
    REFHC2 = REFASC+1
    REFHC3 = REFHC2+1
    REFIC = REFHC3+1
    REFHC5 = REFIC+1
    REFHC6 = REFHC5+1
    REFDESC = REFHC6+1
    REFHC8 = REFDESC+1
    REFHC9 = REFHC8+1
    REFMC = REFHC9+1
    REFHC11 = REFMC+1
    REFHC12 = REFHC11+1

    ASC = 0
    HC2 = ASC+1
    HC3 = HC2+1
    IC = HC3+1
    HC5 = IC+1
    HC6 = HC5+1
    DESC = HC6+1
    HC8 = DESC+1
    HC9 = HC8+1
    MC = HC9+1
    HC11 = MC+1
    HC12 = HC11+1
    PLOFFS = HC12+1
    SUN = PLOFFS
    MOON = SUN+1
    MERCURY = MOON+1
    VENUS = MERCURY+1
    MARS = VENUS+1
    JUPITER = MARS+1
    SATURN = JUPITER+1
    LORDOFFS = SATURN+1
    ASCLORD = LORDOFFS
    HC2LORD = ASCLORD+1
    HC3LORD = HC2LORD+1
    ICLORD = HC3LORD+1
    HC5LORD = ICLORD+1
    HC6LORD = HC5LORD+1
    DESCLORD = HC6LORD+1
    HC8LORD = DESCLORD+1
    HC9LORD = HC8LORD+1
    MCLORD = HC9LORD+1
    HC11LORD = MCLORD+1
    HC12LORD = HC11LORD+1
    SPECIAL = HC12LORD+1
    LOF = SPECIAL
    LOFLORD = LOF+1
    SYZ = LOFLORD+1
    SYZLORD = SYZ+1
    DEG = SYZLORD+1
    DEGLORD = DEG+1
    RE = DEGLORD+1
    REFLORD = RE+1
    ASCNODE = REFLORD+1
    DESCNODE = ASCNODE+1
    URANUS = DESCNODE+1
    NEPTUNE = URANUS+1
    PLUTO = NEPTUNE+1

    HNUM = houses.Houses.HOUSE_NUM-1

    @staticmethod
    def is_gendered_item(ar_item):
        try:
            if bool(ar_item[ArabicParts.GENDERED]):
                return True
        except Exception:
            pass
        return ArabicParts.has_female_formula(ar_item)

    @staticmethod
    def _is_formula_triplet(value):
        return isinstance(value, (list, tuple)) and len(value) >= 3

    @staticmethod
    def _normalize_formula_triplet(value, fallback=(0, 0, 0)):
        if ArabicParts._is_formula_triplet(value):
            try:
                return tuple(_coerce_formula_code(v) for v in value[:3])
            except Exception:
                return (value[0], value[1], value[2])
        return fallback

    @staticmethod
    def _normalize_ref_triplet(value):
        if isinstance(value, (list, tuple)) and len(value) >= 3:
            try:
                return normalize_refdeg_triplet(value)
            except Exception:
                return (value[0], value[1], value[2])
        return (0, 0, 0)

    @staticmethod
    def is_legacy_item(ar_item):
        try:
            return (
                isinstance(ar_item, (list, tuple)) and
                len(ar_item) >= 4 and
                ArabicParts._is_formula_triplet(ar_item[ArabicParts.FORMULA]) and
                isinstance(ar_item[2], (list, tuple)) and len(ar_item[2]) >= 3 and
                isinstance(ar_item[3], bool)
            )
        except Exception:
            return False

    @staticmethod
    def get_diurnal_flag(ar_item):
        try:
            if ArabicParts.is_legacy_item(ar_item):
                return bool(ar_item[3])
            return bool(ar_item[ArabicParts.DIURNAL])
        except Exception:
            return False

    @staticmethod
    def get_refdeg_triplet_base(ar_item):
        try:
            if ArabicParts.is_legacy_item(ar_item):
                return ArabicParts._normalize_ref_triplet(ar_item[2])
            return ArabicParts._normalize_ref_triplet(ar_item[3] if len(ar_item) > 3 else None)
        except Exception:
            return (0, 0, 0)

    @staticmethod
    def is_active_item(ar_item):
        try:
            if ArabicParts.is_legacy_item(ar_item):
                return True
            if len(ar_item) > 4:
                return bool(ar_item[4])
        except Exception:
            pass
        return True

    @staticmethod
    def has_female_formula(ar_item):
        try:
            return ArabicParts._is_formula_triplet(ar_item[ArabicParts.FEMALE_FORMULA])
        except Exception:
            return False

    @staticmethod
    def has_nocturnal_formula(ar_item):
        try:
            return ArabicParts._is_formula_triplet(ar_item[ArabicParts.NOCTURNAL_FORMULA])
        except Exception:
            return False

    @staticmethod
    def get_formula_triplet(ar_item, male=True):
        formula = ArabicParts._normalize_formula_triplet(
            ar_item[ArabicParts.FORMULA] if len(ar_item) > ArabicParts.FORMULA else None
        )
        ref_triplet = ArabicParts.get_refdeg_triplet_base(ar_item)
        if (not male) and ArabicParts.has_female_formula(ar_item):
            try:
                formula = ArabicParts._normalize_formula_triplet(
                    ar_item[ArabicParts.FEMALE_FORMULA], formula
                )
            except Exception:
                pass
            try:
                ref_triplet = ArabicParts._normalize_ref_triplet(
                    ar_item[ArabicParts.FEMALE_REFDEG]
                )
            except Exception:
                ref_triplet = (0, 0, 0)
        return formula, ref_triplet

    @staticmethod
    def get_nocturnal_formula_triplet(ar_item, fallback_formula=None, fallback_refdeg=None):
        if fallback_formula is None:
            fallback_formula, fallback_refdeg = ArabicParts.get_formula_triplet(ar_item, True)
        formula = ArabicParts._normalize_formula_triplet(
            ar_item[ArabicParts.NOCTURNAL_FORMULA]
            if len(ar_item) > ArabicParts.NOCTURNAL_FORMULA else None,
            fallback_formula,
        )
        try:
            ref_triplet = ArabicParts._normalize_ref_triplet(ar_item[ArabicParts.NOCTURNAL_REFDEG])
        except Exception:
            ref_triplet = fallback_refdeg if fallback_refdeg is not None else (0, 0, 0)
        return formula, ref_triplet

    @staticmethod
    def get_active_formula_triplet(ar_item, abovehorizon, male=True):
        formula, ref_triplet = ArabicParts.get_formula_triplet(ar_item, male)
        if (not abovehorizon) and ArabicParts.has_nocturnal_formula(ar_item):
            formula, ref_triplet = ArabicParts.get_nocturnal_formula_triplet(
                ar_item, formula, ref_triplet
            )
        if ArabicParts.should_swap_formula(ar_item, abovehorizon, male):
            formula = (formula[0], formula[2], formula[1])
            ref_triplet = (ref_triplet[0], ref_triplet[2], ref_triplet[1])
        return formula, ref_triplet

    @staticmethod
    def should_swap_formula(ar_item, abovehorizon, male):
        swap = False
        try:
            if (
                ArabicParts.get_diurnal_flag(ar_item)
                and (not abovehorizon)
                and (not ArabicParts.has_nocturnal_formula(ar_item))
            ):
                swap = not swap
        except Exception:
            pass
        try:
            if (not male) and ArabicParts.is_gendered_item(ar_item) and (not ArabicParts.has_female_formula(ar_item)):
                swap = not swap
        except Exception:
            pass
        return swap

    @staticmethod
    def format_formula_text(ar_item, abovehorizon=True, male=True, ref_names=None):
        """Render an Arabic Part as 'tok1 + tok2 - tok3' using the active
        triplet (already swapped for diurnal/nocturnal and gendered cases).
        Matches the dialog's formula column so the inspector reads the same."""
        try:
            formula, ref_triplet = ArabicParts.get_active_formula_triplet(ar_item, abovehorizon, male)
        except Exception:
            return None
        try:
            return u'%s + %s - %s' % (
                _format_formula_token(formula[0], 0, ref_triplet, ref_names=ref_names),
                _format_formula_token(formula[1], 1, ref_triplet, ref_names=ref_names),
                _format_formula_token(formula[2], 2, ref_triplet, ref_names=ref_names),
            )
        except Exception:
            return None

    @staticmethod
    def find_ar_item_by_name(ar, name):
        """First entry in `ar` whose NAME slot equals *name*, or None.
        Used to map a computed part back to its source row when the index
        in `ArabicParts.parts` (filtered to active items) doesn't line up
        with the original `options.ar` index."""
        if not ar or not name:
            return None
        try:
            for item in ar:
                try:
                    if item[ArabicParts.NAME] == name:
                        return item
                except Exception:
                    continue
        except Exception:
            return None
        return None

    def _get_refordeg_triplet(self, ar_item, male=True):
        return ArabicParts.get_formula_triplet(ar_item, male)[1]
    def _deg_abs_to_internal(self, absdeg, opts):
        """Return an absolute degree in the chart's selected zodiac."""
        try:
            lon = float(absdeg) % 360.0
        except Exception:
            lon = 0.0
        return lon

    def __init__(self, ar, ascmc, pls, hs, cusps, fort, syz, opts, ayanamsha_deg=0.0, male=True): #ar is from options
        # chart.ayanamsha(도 단위) 보정값. (opts.ayanamsha != 0 인 경우에만 의미 있음)
        try:
            self._ayanamsha_deg = float(ayanamsha_deg) % 360.0
        except Exception:
            self._ayanamsha_deg = 0.0

        # ``motion_regimes`` is aligned with ``parts``; the by-config variant
        # retains the original options index (including inactive entries).
        # The immutable trace contains only formula/selector branches.  Raw
        # longitudes never enter it, so ordinary continuous motion does not
        # look like a semantic regime change to exact-aspect root finding.
        self.motion_regimes = None
        self.motion_regimes_by_config = None

        if ar == None:
            self.parts = None
        else:
            self.doms = [4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5]
            self.exals = [0, 1, -1, 5, -1, -1, 6, -1, -1, 4, -1, 3]
            self.tripls = [0, 3, 1, 2, 0, 3, 1, 2, 0, 3, 1, 2]

            asc = hs.ascmc[houses.Houses.ASC]
            desc = util.normalize(hs.ascmc[houses.Houses.ASC]+180.0)
            mc = hs.ascmc[houses.Houses.MC]
            ic = util.normalize(hs.ascmc[houses.Houses.MC]+180.0)

            cps = (asc, cusps[2], cusps[3], ic, cusps[5], cusps[6], desc, cusps[8], cusps[9], mc, cusps[11], cusps[12])
            # --- FORWARD RE SUPPORT: enable forward references (R{future}) ---
            # 활성(표시)되는 항목들의 원본 인덱스 목록을 만든다.
            enabled_idx = []
            for ii in range(len(ar)):
                try:
                    if not ArabicParts.is_active_item(ar[ii]):
                        continue
                except:
                    pass
                enabled_idx.append(ii)

            def _lof_lon():
                idAsc = self.adjustAscendant(ArabicParts.ASC, opts)
                asclon = cps[idAsc]
                return self.getLoFLon(opts.lotoffortune, asclon, pls, fort.abovehorizon)

            def _freeze_regime(value):
                if isinstance(value, dict):
                    return tuple(
                        (str(key), _freeze_regime(item))
                        for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
                    )
                if isinstance(value, (list, tuple)):
                    return tuple(_freeze_regime(item) for item in value)
                if isinstance(value, set):
                    return tuple(sorted((_freeze_regime(item) for item in value), key=repr))
                if isinstance(value, float):
                    if math.isnan(value):
                        return ('float', 'nan')
                    if math.isinf(value):
                        return ('infinite-float', 1 if value > 0.0 else -1)
                    return round(value, 9)
                if value is None or isinstance(value, (bool, int, str)):
                    return value
                value_type = type(value)
                return ('object', value_type.__module__, value_type.__qualname__)

            def _fortune_regime():
                # LFMOONSUN never changes formula at the horizon.  The other
                # two options do, so their active orientation is the selector.
                formula_type = int(getattr(opts, 'lotoffortune', chart.Chart.LFMOONSUN))
                above = bool(getattr(fort, 'abovehorizon', False))
                if formula_type == chart.Chart.LFMOONSUN:
                    orientation = 'moon-sun'
                elif formula_type == chart.Chart.LFDSUNMOON:
                    orientation = 'sun-moon' if above else 'moon-sun'
                else:
                    orientation = 'moon-sun' if above else 'sun-moon'
                return ('fortune', formula_type, orientation)

            def _syzygy_regime():
                supplied = getattr(syz, 'regime', None)
                if supplied is not None:
                    return _freeze_regime(supplied)
                event_time = getattr(getattr(syz, 'time', None), 'jd', None)
                try:
                    event_time = round(float(event_time), 7)
                except Exception:
                    event_time = None
                newmoon = getattr(syz, 'newmoon', None)
                phase = 'new' if newmoon is True else 'full' if newmoon is False else 'unknown'
                selected = getattr(syz, 'selected', None)
                return ('syzygy', phase, event_time, selected)

            def _active_formula_regime(ar_item, formula_ids, ref_triplet):
                selectors = []
                above = bool(getattr(fort, 'abovehorizon', False))
                if ArabicParts.get_diurnal_flag(ar_item) or ArabicParts.has_nocturnal_formula(ar_item):
                    selectors.append(('sect', 'day' if above else 'night'))
                if ArabicParts.is_gendered_item(ar_item):
                    selectors.append(('gender', 'male' if male else 'female'))

                source = 'base'
                if (not male) and ArabicParts.has_female_formula(ar_item):
                    source = 'female'
                if (not above) and ArabicParts.has_nocturnal_formula(ar_item):
                    source = 'nocturnal'
                if ArabicParts.should_swap_formula(ar_item, above, male):
                    selectors.append(('swapped', True))
                return (
                    'formula',
                    tuple(int(code) for code in formula_ids),
                    _freeze_regime(ref_triplet),
                    source,
                    tuple(selectors),
                )

            def _sign_lord(lon):
                sign = int(lon / chart.Chart.SIGN_DEG)
                lord = -1
                for pid in range(astrology.SE_SATURN + 1):
                    if opts.dignities[pid][0][sign]:
                        lord = pid
                return sign, lord

            def _fallback_trace(reason, target=None):
                return ('fallback', str(reason), _freeze_regime(target), _fortune_regime())

            def _node_lon(code):
                try:
                    idx = astrology.SE_MEAN_NODE if code == ArabicParts.ASCNODE else astrology.SE_TRUE_NODE
                    return pls.planets[idx].data[planets.Planet.LONG]
                except Exception:
                    return _lof_lon()

            # k: 표시 리스트(LoF 제외)에서 0-based 인덱스
            def _calc_lon_by_k(k, visiting, trace_out=None):
                if trace_out is None:
                    trace_out = []
                # 범위 밖이면 LoF로 폴백
                if k < 0 or k >= len(ar):
                    trace_out.append(_fallback_trace('out-of-range', k))
                    return _lof_lon()
                # 순환 참조 감지 → LoF 폴백
                if k in visiting:
                    trace_out.append(_fallback_trace('cycle', k))
                    return _lof_lon()

                ii = k
                # === 아래는 기존 본문과 동일한 계산을 요약 재구성 (A/B/C 만들기) ===
                formula_ids, ref_triplet = ArabicParts.get_active_formula_triplet(
                    ar[ii], fort.abovehorizon, male
                )
                trace_out.append(_active_formula_regime(ar[ii], formula_ids, ref_triplet))
                A_id, B_id, C_id = formula_ids
                refA, refB, refC = ref_triplet
                # Resolve a single formula token to longitude
                def _resolve_token(code, sub_refdeg_val=0, depth=0, selector_trace=None):
                    if selector_trace is None:
                        selector_trace = trace_out
                    if depth > 10:
                        selector_trace.append(_fallback_trace('depth', code))
                        return _lof_lon()
                    if code < ArabicParts.PLOFFS:
                        return cps[self.adjustAscendant(code, opts)]
                    elif code < ArabicParts.LORDOFFS:
                        return pls.planets[code - ArabicParts.PLOFFS].data[planets.Planet.LONG]
                    elif code < ArabicParts.SPECIAL:
                        cid = self.adjustAscendant(code - ArabicParts.LORDOFFS, opts)
                        sign, lord = _sign_lord(cps[cid])
                        selector_trace.append(('houseLord', int(code), int(cid), sign, lord))
                        if lord == -1:
                            selector_trace.append(_fallback_trace('house-lord', (code, cid, sign)))
                        return pls.planets[lord].data[planets.Planet.LONG] if lord != -1 else _lof_lon()
                    elif code < ArabicParts.SYZ:
                        lon = _lof_lon()
                        if code == ArabicParts.LOFLORD:
                            sign, lord = _sign_lord(lon)
                            selector_trace.append(('fortuneLord', _fortune_regime(), sign, lord))
                            if lord == -1:
                                selector_trace.append(_fallback_trace('fortune-lord', sign))
                            return pls.planets[lord].data[planets.Planet.LONG] if lord != -1 else _lof_lon()
                        selector_trace.append(_fortune_regime())
                        return lon
                    elif code <= ArabicParts.SYZLORD:
                        lon = syz.lon
                        if code == ArabicParts.SYZLORD:
                            sign, lord = _sign_lord(lon)
                            selector_trace.append(('syzygyLord', _syzygy_regime(), sign, lord))
                            if lord == -1:
                                selector_trace.append(_fallback_trace('syzygy-lord', sign))
                            return pls.planets[lord].data[planets.Planet.LONG] if lord != -1 else _lof_lon()
                        selector_trace.append(_syzygy_regime())
                        return lon
                    elif code < ArabicParts.RE:
                        # DEG / DEGLORD
                        val = float(sub_refdeg_val) % 360.0
                        if code == ArabicParts.DEGLORD:
                            sign, lord = _sign_lord(val)
                            selector_trace.append(('degreeLord', sign, lord))
                            if lord == -1:
                                selector_trace.append(_fallback_trace('degree-lord', sign))
                            return pls.planets[lord].data[planets.Planet.LONG] if lord != -1 else _lof_lon()
                        return self._deg_abs_to_internal(val, opts)
                    elif code in (ArabicParts.RE, ArabicParts.REFLORD):
                        # RE / REFLORD
                        lonX = _re_resolve(code, sub_refdeg_val, depth + 1, selector_trace)
                        return lonX
                    elif code in (ArabicParts.ASCNODE, ArabicParts.DESCNODE):
                        return _node_lon(code)
                    elif ArabicParts.URANUS <= code <= ArabicParts.PLUTO:
                        planet_id = astrology.SE_URANUS + (code - ArabicParts.URANUS)
                        return pls.planets[planet_id].data[planets.Planet.LONG]
                    selector_trace.append(_fallback_trace('unknown-token', code))
                    return _lof_lon()

                # Evaluate an embedded formula tuple → longitude
                def _eval_embedded(formula_tuple, depth=0, embedded_trace=None):
                    if embedded_trace is None:
                        embedded_trace = []
                    if depth > 10:
                        embedded_trace.append(_fallback_trace('embedded-depth', depth))
                        return _lof_lon()
                    if not isinstance(formula_tuple, (list, tuple)) or len(formula_tuple) < 3:
                        embedded_trace.append(_fallback_trace('invalid-embedded', formula_tuple))
                        return _lof_lon()
                    formula_tuple = embedded_formula_pack(
                        formula_tuple[:3],
                        formula_tuple[3] if len(formula_tuple) > 3 else (0, 0, 0),
                    )
                    embedded_codes = formula_tuple[:3]
                    embedded_ref = formula_tuple[3]
                    for src_idx, src_item in enumerate(ar):
                        try:
                            src_codes = normalize_formula_codes(src_item[ArabicParts.FORMULA])
                            src_ref = normalize_refdeg_triplet(ArabicParts.get_refdeg_triplet_base(src_item))
                        except Exception:
                            continue
                        matches_source = src_codes == embedded_codes and src_ref == embedded_ref
                        if not matches_source and ArabicParts.has_nocturnal_formula(src_item):
                            try:
                                src_codes, src_ref = ArabicParts.get_nocturnal_formula_triplet(
                                    src_item, src_codes, src_ref
                                )
                                matches_source = src_codes == embedded_codes and src_ref == embedded_ref
                            except Exception:
                                matches_source = False
                        if matches_source:
                            if src_idx in visiting:
                                embedded_trace.append(_fallback_trace('cycle', src_idx))
                                return _lof_lon()
                            child_trace = []
                            lon = _calc_lon_by_k(src_idx, visiting | {k}, child_trace)
                            embedded_trace.append(
                                ('configReference', int(src_idx), tuple(child_trace))
                            )
                            return lon

                    eA, eB, eC = embedded_codes
                    # Optional nested refdeg for sub-formulas with DE/RE
                    sub_rd = embedded_ref
                    inline_trace = [
                        ('formula', tuple(embedded_codes), _freeze_regime(embedded_ref), 'embedded', ())
                    ]
                    lA = _resolve_token(eA, sub_rd[0], depth, inline_trace)
                    lB = _resolve_token(eB, sub_rd[1], depth, inline_trace)
                    lC = _resolve_token(eC, sub_rd[2], depth, inline_trace)
                    embedded_trace.append(('embeddedFormula', tuple(inline_trace)))
                    return util.normalize(lA + lB - lC)

                # RE/REFLORD reference resolver
                def _re_resolve(idX, ref_value, depth=0, selector_trace=None):
                    if selector_trace is None:
                        selector_trace = trace_out
                    if depth > 10:
                        selector_trace.append(_fallback_trace('reference-depth', depth))
                        return _lof_lon()
                    reference_trace = []
                    # Embedded formula: tuple (A, B, C [, sub_refdeg])
                    if isinstance(ref_value, (list, tuple)):
                        identity = ('embedded', _freeze_regime(ref_value))
                        lonX = _eval_embedded(ref_value, depth, reference_trace)
                    # Legacy name-based reference (string)
                    elif isinstance(ref_value, str):
                        ref = 0
                        for ri in range(len(ar)):
                            if ar[ri][ArabicParts.NAME] == ref_value:
                                ref = ri + 1
                                break
                        identity = ('name', ref_value, ref - 1 if ref else None)
                        if ref == 0:
                            reference_trace.append(_fallback_trace('missing-reference', identity))
                            lonX = _lof_lon()
                        else:
                            lonX = _calc_lon_by_k(ref - 1, visiting | {k}, reference_trace)
                    else:
                        # Legacy numeric index
                        ref = int(ref_value)
                        identity = ('index', ref - 1 if ref else None)
                        if ref == 0:
                            reference_trace.append(_fallback_trace('missing-reference', identity))
                            lonX = _lof_lon()
                        else:
                            lonX = _calc_lon_by_k(ref - 1, visiting | {k}, reference_trace)
                    reference_event = ('reference', identity, tuple(reference_trace))
                    # REFLORD: resolve to sign lord
                    if idX in (ArabicParts.REFLORD,):
                        sign, lord = _sign_lord(lonX)
                        selector_trace.append(('referenceLord', reference_event, sign, lord))
                        if lord != -1:
                            lonX = pls.planets[lord].data[planets.Planet.LONG]
                        else:
                            selector_trace.append(_fallback_trace('reference-lord', sign))
                            lonX = _lof_lon()
                    else:
                        selector_trace.append(reference_event)
                    return lonX

                lonA = _resolve_token(A_id, refA)
                lonB = _resolve_token(B_id, refB)
                lonC = _resolve_token(C_id, refC)

                diff = lonB - lonC
                if diff < 0.0:
                    diff += 360.0
                lon = lonA + diff
                if lon > 360.0:
                    lon -= 360.0
                return lon
            # --- /FORWARD RE SUPPORT ---

            self.parts = []
            self.motion_regimes = []
            self.motion_regimes_by_config = [None] * len(ar)
            num = len(ar)
            for i in range(num):
                try:
                    if not ArabicParts.is_active_item(ar[i]):
                        continue
                except:
                    pass
                formula_ids, _ = ArabicParts.get_formula_triplet(ar[i], male)
                part = [ar[i][ArabicParts.NAME], formula_ids, ArabicParts.get_diurnal_flag(ar[i]), 0.0, [[-1,0],[-1,0],[-1,0]], ArabicParts.is_gendered_item(ar[i])]
                # calc longitude via the unified forward/recursive resolver
                motion_trace = []
                try:
                    lon = _calc_lon_by_k(i, set(), motion_trace)
                except Exception:
                    lon = _lof_lon()
                    motion_trace.append(_fallback_trace('exception', i))
                part[ArabicParts.LONG] = lon

                tmplon = lon
                degwinner = [[-1,0],[-1,0],[-1,0]]
                for p in range(astrology.SE_SATURN+1):
                    score = 0
                    scoretxt = ''
                    s, st, sh = self.getData(opts, p, tmplon, fort.abovehorizon)

                    score += s
                    scoretxt += st

                    if score > degwinner[0][1]:
                        degwinner[0][0] = p
                        degwinner[0][1] = score
                        degwinner[1][0] = -1
                        degwinner[2][0] = -1
                    elif score == degwinner[0][1]:
                        if degwinner[1][0] == -1:
                            degwinner[1][0] = p
                        else:
                            degwinner[2][0] = p


                part[ArabicParts.DEGWINNER] = degwinner

                self.parts.append(part)
                regime = ('arabicPart', tuple(motion_trace))
                self.motion_regimes.append(regime)
                self.motion_regimes_by_config[i] = regime

            self.motion_regimes = tuple(self.motion_regimes)
            self.motion_regimes_by_config = tuple(self.motion_regimes_by_config)


    def adjustAscendant(self, Id, opts):
        if opts.arabicpartsref != 0:
            Id += opts.arabicpartsref
            if Id > ArabicParts.HNUM:
                Id -= ArabicParts.HNUM

        return Id


    def getLoFLon(self, typ, asclon, pls, abovehorizon):
        lon = 0.0
        if typ == chart.Chart.LFMOONSUN:
            diff = pls.planets[astrology.SE_MOON].data[planets.Planet.LONG]-pls.planets[astrology.SE_SUN].data[planets.Planet.LONG]
            if diff < 0.0:
                diff += 360.0
            lon = asclon+diff
            if lon > 360.0:
                lon -= 360.0
        elif typ == chart.Chart.LFDSUNMOON:
            diff = 0.0
            if abovehorizon:
                diff = pls.planets[astrology.SE_SUN].data[planets.Planet.LONG]-pls.planets[astrology.SE_MOON].data[planets.Planet.LONG]
            else:
                diff = pls.planets[astrology.SE_MOON].data[planets.Planet.LONG]-pls.planets[astrology.SE_SUN].data[planets.Planet.LONG]

            if diff < 0.0:
                diff += 360.0
            lon = asclon+diff
            if lon > 360.0:
                lon -= 360.0
        elif typ == chart.Chart.LFDMOONSUN:
            diff = 0.0
            if abovehorizon:
                diff = pls.planets[astrology.SE_MOON].data[planets.Planet.LONG]-pls.planets[astrology.SE_SUN].data[planets.Planet.LONG]
            else:
                diff = pls.planets[astrology.SE_SUN].data[planets.Planet.LONG]-pls.planets[astrology.SE_MOON].data[planets.Planet.LONG]

            if diff < 0.0:
                diff += 360.0
            lon = asclon+diff
            if lon > 360.0:
                lon -= 360.0

        return lon


    def getData(self, opts, i, lon, daytime):
        '''i is the index of the planet, and lon is the longitude to check'''

        score = 0
        scoretxt = ''
        share = 0

        sign = int(lon/chart.Chart.SIGN_DEG)
        if i == self.doms[sign]:
            sc = opts.dignityscores[0]
            score += sc
            add = '+'
            if scoretxt == '':
                add = ''
            scoretxt += add+str(sc)
            share += 1
        if self.exals[sign] != -1 and i == self.exals[sign]:
            sc = opts.dignityscores[1]
            score += sc
            add = '+'
            if scoretxt == '':
                add = ''
            scoretxt += add+str(sc)
            share += 1
        if opts.oneruler:
            tr = self.tripls[sign]
            tripl = 0
            if daytime:
                tripl = opts.trips[opts.seltrip][tr][0]
            else:
                tripl = opts.trips[opts.seltrip][tr][1]

            if tripl == i:
                sc = opts.dignityscores[2]
                score += sc
                add = '+'
                if scoretxt == '':
                    add = ''
                scoretxt += add+str(sc)
                share += 1
        else:
            tr = self.tripls[sign]
            for k in range(3):#3 is the maximum number of triplicity rulers
                tripl = opts.trips[opts.seltrip][tr][k]

                if tripl != -1 and tripl == i:
                    sc = opts.dignityscores[2]
                    score += sc 
                    add = '+'
                    if scoretxt == '':
                        add = ''
                    scoretxt += add+str(sc)
                    share += 1
                    break

        pos = lon%chart.Chart.SIGN_DEG

        subnum = len(opts.terms[0][0])
        summa = 0.0
        for t in range(subnum):
            summa += opts.terms[opts.selterm][sign][t][1]#degs
            if summa > pos:
                break

        term = opts.terms[opts.selterm][sign][t][0]#planet
        if term == i:
            sc = opts.dignityscores[3]
            score += sc
            add = '+'
            if scoretxt == '':
                add = ''
            scoretxt += add+str(sc)
            share += 1

        dec = int(pos/10)
        decan = opts.decans[opts.seldecan][sign][dec]
        if decan == i:
            sc = opts.dignityscores[4]
            score += sc
            add = '+'
            if scoretxt == '':
                add = ''
            scoretxt += add+str(sc)
            share += 1

        return score, scoretxt, share


def _format_formula_token(code, idx_abc, ref_triplet, ref_names=None):
    """Render one token of a formula triplet. Mirrors PartsListCtrl
    _render_token_text in arabicpartsdlg.py but stays out of wx, so the
    chart inspector can render formulas without spinning up the dialog."""
    try:
        label = mtexts.partstxts[int(code)]
    except Exception:
        rev = getattr(mtexts, '_conv_rev_cache', None)
        if not isinstance(rev, dict):
            try:
                rev = dict((v, k) for (k, v) in mtexts.conv.items())
            except Exception:
                rev = {}
            mtexts._conv_rev_cache = rev
        label = rev.get(code)
        if label is None:
            try:
                rev = dict((v, k) for (k, v) in mtexts.conv.items())
            except Exception:
                rev = {}
            mtexts._conv_rev_cache = rev
            label = rev.get(code, u'?')

    txt = label
    want_lord = False
    if isinstance(txt, str) and txt.endswith(u'!'):
        want_lord = True
        txt = txt[:-1]

    if txt == mtexts.txts.get('DE', u'DE'):
        try:
            ref = ref_triplet[idx_abc]
        except Exception:
            ref = 0
        try:
            absdeg = int(ref) % 360
        except Exception:
            return u'?' + (u'!' if want_lord else u'')
        signs = (
            mtexts.txts.get('Ari', u'Ari'), mtexts.txts.get('Tau', u'Tau'),
            mtexts.txts.get('Gem', u'Gem'), mtexts.txts.get('Can', u'Can'),
            mtexts.txts.get('Leo2', u'Leo'), mtexts.txts.get('Vir', u'Vir'),
            mtexts.txts.get('Lib', u'Lib'), mtexts.txts.get('Sco', u'Sco'),
            mtexts.txts.get('Sag', u'Sag'), mtexts.txts.get('Cap', u'Cap'),
            mtexts.txts.get('Aqu', u'Aqu'), mtexts.txts.get('Pis', u'Pis'),
        )
        sg = absdeg // 30
        dg = absdeg % 30
        return u'%d°%s' % (dg, signs[sg]) + (u'!' if want_lord else u'')

    if txt == mtexts.txts.get('RE', u'RE'):
        try:
            ref = ref_triplet[idx_abc]
        except Exception:
            ref = 0
        if callable(ref_names):
            try:
                name = ref_names(ref)
            except Exception:
                name = None
            if name:
                return name + (u'!' if want_lord else u'')
        if isinstance(ref, (list, tuple)) and len(ref) >= 3:
            sub = ref[3] if len(ref) > 3 else (0, 0, 0)
            return u'(%s+%s-%s)' % (
                _format_formula_token(ref[0], 0, sub, ref_names=ref_names),
                _format_formula_token(ref[1], 1, sub, ref_names=ref_names),
                _format_formula_token(ref[2], 2, sub, ref_names=ref_names),
            ) + (u'!' if want_lord else u'')
        if isinstance(ref, str):
            return ref + (u'!' if want_lord else u'')
        try:
            return u'#%d' % (int(ref) + 1) + (u'!' if want_lord else u'')
        except Exception:
            return u'#?' + (u'!' if want_lord else u'')

    return label


# Lot of Fortune formula text — three variants per chart.Chart constants.
# Distinct from the custom-parts formatter because LoF doesn't sit in
# options.ar (the user picks it via fortunedlg) so there's no ar_item to
# resolve. Kept in arabicparts so the inspector has one entry point for
# any lot it might hover.
# ---------------------------------------------------------------------------
# Lot-formula calculator brain (wx-free) — JSON import/export + part-tuple
# builder. Transcribed from arabicpartsdlg.py (the wx Add/Modify calculator)
# so the webapp daemon and the wx dialog share one serialization contract.
# The wx dialog keeps its own private copies; these are the headless twins.
# ---------------------------------------------------------------------------

# Canonical (language-independent) names for formula codes, used in JSON
# export/import. Verbatim legacy codes stay unchanged; outer planets append.
CODE_TO_NAME = {
    0: 'ASC', 1: 'HC2', 2: 'HC3', 3: 'IC', 4: 'HC5', 5: 'HC6',
    6: 'DESC', 7: 'HC8', 8: 'HC9', 9: 'MC', 10: 'HC11', 11: 'HC12',
    12: 'SUN', 13: 'MOON', 14: 'MERCURY', 15: 'VENUS', 16: 'MARS',
    17: 'JUPITER', 18: 'SATURN',
    19: 'ASC!', 20: 'HC2!', 21: 'HC3!', 22: 'IC!',
    23: 'HC5!', 24: 'HC6!', 25: 'DESC!', 26: 'HC8!',
    27: 'HC9!', 28: 'MC!', 29: 'HC11!', 30: 'HC12!',
    31: 'LOF', 32: 'LOF!', 33: 'SYZ', 34: 'SYZ!',
    35: 'DEG', 36: 'DEG!', 37: 'RE', 38: 'RE!',
    39: 'ASC_NODE', 40: 'DESC_NODE',
    41: 'URANUS', 42: 'NEPTUNE', 43: 'PLUTO',
}
NAME_TO_CODE = {v: k for k, v in CODE_TO_NAME.items()}

MAX_ARABICPARTS_NUM = 360  # arabicpartsdlg.py:122 (count includes the LoF row)

_RE_CODES = (ArabicParts.RE, ArabicParts.REFLORD)
_DE_CODES = (ArabicParts.DEG, ArabicParts.DEGLORD)


def _coerce_formula_code(value):
    if isinstance(value, bool):
        return 0
    if isinstance(value, str):
        if value in NAME_TO_CODE:
            return NAME_TO_CODE[value]
        try:
            value = int(value)
        except Exception:
            return 0
    try:
        code = int(value)
    except Exception:
        return 0
    return code if code in CODE_TO_NAME else 0


def normalize_formula_codes(codes, fallback=(0, 0, 0)):
    source = list(codes) if isinstance(codes, (list, tuple)) else list(fallback)
    source = (source + list(fallback))[:3]
    return tuple(_coerce_formula_code(v) for v in source)


def normalize_refdeg_triplet(trip):
    source = list(trip) if isinstance(trip, (list, tuple)) else [0, 0, 0]
    source = (source + [0, 0, 0])[:3]
    return tuple(_normalize_refdeg_value(v) for v in source)


def embedded_formula_pack(codes, refdeg=(0, 0, 0)):
    return normalize_formula_codes(codes) + (normalize_refdeg_triplet(refdeg),)


def make_ref_name_resolver(ar, lof_name=u'Fortuna'):
    row_names = _row_names(ar, lof_name)
    embedded_names = {}
    for item in ar or []:
        try:
            name = str(item[ArabicParts.NAME])
            codes = normalize_formula_codes(item[ArabicParts.FORMULA])
            trip = normalize_refdeg_triplet(ArabicParts.get_refdeg_triplet_base(item))
            embedded_names.setdefault(embedded_formula_pack(codes, trip), name)
            if ArabicParts.has_nocturnal_formula(item):
                ncodes, ntrip = ArabicParts.get_nocturnal_formula_triplet(item, codes, trip)
                embedded_names.setdefault(embedded_formula_pack(ncodes, ntrip), name)
        except Exception:
            continue

    def _resolve(ref):
        if isinstance(ref, str):
            return ref
        if isinstance(ref, (list, tuple)) and len(ref) >= 3:
            return embedded_names.get(embedded_formula_pack(
                ref[:3],
                ref[3] if len(ref) > 3 else (0, 0, 0),
            ))
        try:
            idx = int(ref)
        except Exception:
            return None
        if 0 <= idx < len(row_names):
            return row_names[idx]
        return None

    return _resolve


def _normalize_refdeg_value(value):
    """Coerce one refdeg slot to its stored shape: int, name string, or an
    embedded-formula tuple (A, B, C[, sub_refdeg]) with nested lists made
    tuples (the shape PartsListCtrl keeps in parts_refdeg)."""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        if len(value) < 3:
            return 0
        sub = value[3] if len(value) > 3 else (0, 0, 0)
        return embedded_formula_pack(value[:3], sub)
    try:
        return int(value)
    except Exception:
        return 0


def _normalize_formula_refdeg(codes, refdeg):
    codes = normalize_formula_codes(codes)
    trip = list(refdeg if isinstance(refdeg, (list, tuple)) and len(refdeg) >= 3 else (0, 0, 0))[:3]
    out_trip = []
    for i in range(3):
        if codes[i] in _RE_CODES:
            out_trip.append(_normalize_refdeg_value(trip[i]))
        elif codes[i] in _DE_CODES:
            try:
                out_trip.append(int(trip[i]) % 360)
            except Exception:
                out_trip.append(0)
        else:
            out_trip.append(0)
    return codes, tuple(out_trip)


def build_part_tuple(name, codes, diurnal, refdeg, active=True, gendered=False,
                     female_codes=None, female_refdeg=(0, 0, 0),
                     nocturnal_codes=None, nocturnal_refdeg=(0, 0, 0)):
    """Build one options.arabicparts row exactly the way the wx calculator
    serializes it: PartsListCtrl.save (arabicpartsdlg.py:462-474) for the slot
    order, _handle_token_click (:1694-1695) for zeroing non-RE/DE refdeg slots,
    OnModify (:1876-1884) for the DE %360 clamp, and
    _current_female_formula_for_save (:814-825) for dropping a female formula
    identical to the base one."""
    codes, out_trip = _normalize_formula_refdeg(codes, refdeg)
    n_codes = None
    n_out = None
    if isinstance(nocturnal_codes, (list, tuple)) and len(nocturnal_codes) == 3:
        n_codes, n_out = _normalize_formula_refdeg(nocturnal_codes, nocturnal_refdeg)
        if n_codes == codes and n_out == out_trip:
            n_codes = None
            n_out = None

    item = [str(name), codes, bool(diurnal), out_trip, bool(active), bool(gendered)]
    if isinstance(female_codes, (list, tuple)) and len(female_codes) == 3:
        f_codes, f_out = _normalize_formula_refdeg(female_codes, female_refdeg)
        # Identical female formula collapses to "swap" semantics — drop it
        # (arabicpartsdlg.py:823-824).
        if not (f_codes == codes and f_out == out_trip):
            item.extend([f_codes, f_out])
    if n_codes is not None and n_out is not None:
        while len(item) < ArabicParts.NOCTURNAL_FORMULA:
            item.append(None if len(item) == ArabicParts.FEMALE_FORMULA else (0, 0, 0))
        item.extend([n_codes, n_out])
    return tuple(item)


def _row_names(ar, lof_name):
    """Dialog row-name list: LoF pinned at row 0, then options.arabicparts in
    order (arabicpartsdlg.py:1228-1243)."""
    names = [str(lof_name)]
    for it in ar or []:
        try:
            names.append(str(it[ArabicParts.NAME]))
        except Exception:
            names.append(u'')
    return names


def _resolve_refdeg_for_export(codes, trip, row_names):
    """Transcription of ArabicPartsDlg._resolve_refdeg_for_export
    (arabicpartsdlg.py:2398-2424): serialize embedded RE formulas as
    {"formula": [...], "refdeg": [...]} and legacy numeric refs as names."""
    def _embedded_to_export(ref):
        ref = embedded_formula_pack(ref[:3], ref[3] if len(ref) > 3 else (0, 0, 0))
        sub_rd = normalize_refdeg_triplet(ref[3])
        sub_out = list(sub_rd)
        for j in range(3):
            sub_code = ref[j]
            if sub_code in _RE_CODES and isinstance(sub_rd[j], (list, tuple)):
                sub_out[j] = _embedded_to_export(sub_rd[j])
            elif sub_code in _DE_CODES:
                try:
                    sub_out[j] = int(sub_rd[j]) % 360
                except Exception:
                    sub_out[j] = 0
            elif sub_code not in _RE_CODES:
                sub_out[j] = 0
        return {
            "formula": [CODE_TO_NAME.get(c, c) for c in ref[:3]],
            "refdeg": sub_out,
        }

    out = list(normalize_refdeg_triplet(trip))
    for i in range(3):
        if codes[i] in _RE_CODES:
            ref = out[i]
            if isinstance(ref, (list, tuple)) and len(ref) >= 3:
                out[i] = _embedded_to_export(ref)
            elif isinstance(ref, str):
                pass  # Legacy name reference
            else:
                try:
                    idx = int(ref)
                except Exception:
                    idx = -1
                if 0 <= idx < len(row_names):
                    out[i] = row_names[idx]
    return out


def serialize_parts_json(ar, lof_name=u'Fortuna'):
    """Transcription of ArabicPartsDlg.OnExport's payload loop
    (arabicpartsdlg.py:2427-2452) over options.arabicparts rows (the dialog
    iterates list rows 1.. which mirror the stored tuples)."""
    row_names = _row_names(ar, lof_name)
    parts = []
    for item in ar or []:
        name = str(item[ArabicParts.NAME])
        codes = normalize_formula_codes(
            item[ArabicParts.FORMULA] if len(item) > ArabicParts.FORMULA else None)
        trip = ArabicParts.get_refdeg_triplet_base(item)
        out = {
            'name': name,
            'formula': [CODE_TO_NAME.get(c, str(c)) for c in codes],
            'diurnal': bool(ArabicParts.get_diurnal_flag(item)),
            'refdeg': _resolve_refdeg_for_export(codes, trip, row_names),
            'active': bool(ArabicParts.is_active_item(item)),
            'gendered': bool(item[ArabicParts.GENDERED]) if (
                not ArabicParts.is_legacy_item(item) and len(item) > ArabicParts.GENDERED) else False,
        }
        if ArabicParts.has_female_formula(item):
            female_codes = normalize_formula_codes(item[ArabicParts.FEMALE_FORMULA])
            try:
                female_trip = ArabicParts._normalize_ref_triplet(item[ArabicParts.FEMALE_REFDEG])
            except Exception:
                female_trip = (0, 0, 0)
            out['female_formula'] = [CODE_TO_NAME.get(c, str(c)) for c in female_codes]
            out['female_refdeg'] = _resolve_refdeg_for_export(female_codes, female_trip, row_names)
        if ArabicParts.has_nocturnal_formula(item):
            nocturnal_codes, nocturnal_trip = ArabicParts.get_nocturnal_formula_triplet(item, codes, trip)
            out['nocturnal_formula'] = [CODE_TO_NAME.get(c, str(c)) for c in nocturnal_codes]
            out['nocturnal_refdeg'] = _resolve_refdeg_for_export(nocturnal_codes, nocturnal_trip, row_names)
        parts.append(out)
    return parts


def parts_json_text(ar, lof_name=u'Fortuna'):
    """Byte-compatible with the wx export file: json.dump(..., ensure_ascii=
    False, indent=2) — arabicpartsdlg.py:2464-2465."""
    return json.dumps(serialize_parts_json(ar, lof_name), ensure_ascii=False, indent=2)


def _parse_embedded(raw):
    """Transcription of OnImport._parse_embedded (arabicpartsdlg.py:2540-2569):
    resolve a list/dict embedded formula to an integer-code tuple."""
    if isinstance(raw, dict):
        sub_f = raw.get('formula', [0, 0, 0])
        sub_rd_raw = raw.get('refdeg', [0, 0, 0])
    elif isinstance(raw, list):
        sub_f = raw
        sub_rd_raw = [0, 0, 0]
    else:
        return (0, 0, 0)
    sub_codes = normalize_formula_codes(sub_f)
    if not isinstance(sub_rd_raw, (list, tuple)) or len(sub_rd_raw) < 3:
        sub_rd_raw = [0, 0, 0]
    parsed_sub = []
    for sv in list(sub_rd_raw)[:3]:
        if isinstance(sv, (list, dict)):
            parsed_sub.append(_parse_embedded(sv))
        else:
            try:
                parsed_sub.append(int(sv))
            except (ValueError, TypeError):
                parsed_sub.append(0)
    return embedded_formula_pack(sub_codes, parsed_sub)


def parse_parts_json(data, existing_parts, lof_name=u'Fortuna'):
    """Transcription of ArabicPartsDlg.OnImport (arabicpartsdlg.py:2495-2660):
    two-pass parse of the JSON export format. Returns
    (new_part_tuples, added, skipped, unresolved). Appends nothing itself —
    the caller extends options.arabicparts with the returned tuples."""
    if not isinstance(data, list):
        raise ValueError('Invalid format: expected a JSON array.')

    existing_parts = list(existing_parts or [])
    names = set(_row_names(existing_parts, lof_name))  # checkName scans every row incl LoF (:311-316)
    count = 1 + len(existing_parts)  # dialog row count includes the LoF row

    new_items = []  # build_part_tuple results, mutated in pass 2
    deferred_refs = []  # (new_items index, codes, raw_refdeg) for name-based RE refs
    added = 0
    skipped = 0

    for item in data:
        if not isinstance(item, dict) or 'name' not in item or 'formula' not in item:
            skipped += 1
            continue
        name = str(item['name']).strip()
        if not name or name in names:
            skipped += 1
            continue
        raw_formula = item['formula']
        if not isinstance(raw_formula, list) or len(raw_formula) != 3:
            skipped += 1
            continue
        codes = []
        for tok in raw_formula:
            if isinstance(tok, int):
                codes.append(tok)
            elif isinstance(tok, str) and tok in NAME_TO_CODE:
                codes.append(NAME_TO_CODE[tok])
            else:
                codes = None
                break
        if codes is None:
            skipped += 1
            continue
        if count >= MAX_ARABICPARTS_NUM:  # AddFullItemEx limit (:241-243)
            skipped += 1
            continue

        diurnal = bool(item.get('diurnal', False))
        raw_refdeg = item.get('refdeg', [0, 0, 0])
        if not isinstance(raw_refdeg, list) or len(raw_refdeg) != 3:
            raw_refdeg = [0, 0, 0]

        trip = []
        has_name_refs = False
        for i, v in enumerate(raw_refdeg):
            if isinstance(v, (list, dict)) and codes[i] in _RE_CODES:
                trip.append(_parse_embedded(v))
            elif isinstance(v, str) and codes[i] in _RE_CODES:
                trip.append(0)
                has_name_refs = True
            else:
                try:
                    trip.append(int(v))
                except (ValueError, TypeError):
                    trip.append(0)
        trip = tuple(trip)

        active = bool(item.get('active', True))
        gendered = bool(item.get('gendered', False))
        female_codes = None
        female_trip = (0, 0, 0)
        nocturnal_codes = None
        nocturnal_trip = (0, 0, 0)
        raw_female_formula = item.get('female_formula')
        if isinstance(raw_female_formula, list) and len(raw_female_formula) == 3:
            tmp_codes = []
            for tok in raw_female_formula:
                if isinstance(tok, int):
                    tmp_codes.append(tok)
                elif isinstance(tok, str) and tok in NAME_TO_CODE:
                    tmp_codes.append(NAME_TO_CODE[tok])
                else:
                    tmp_codes = None
                    break
            if tmp_codes is not None:
                female_codes = tuple(tmp_codes)
                raw_female_refdeg = item.get('female_refdeg', [0, 0, 0])
                if not isinstance(raw_female_refdeg, list) or len(raw_female_refdeg) != 3:
                    raw_female_refdeg = [0, 0, 0]
                tmp_trip = []
                for i, v in enumerate(raw_female_refdeg):
                    if isinstance(v, (list, dict)) and female_codes[i] in _RE_CODES:
                        tmp_trip.append(_parse_embedded(v))
                    elif isinstance(v, str) and female_codes[i] in _RE_CODES:
                        tmp_trip.append(0)
                    else:
                        try:
                            tmp_trip.append(int(v))
                        except (ValueError, TypeError):
                            tmp_trip.append(0)
                female_trip = tuple(tmp_trip)
        raw_nocturnal_formula = item.get('nocturnal_formula')
        if isinstance(raw_nocturnal_formula, list) and len(raw_nocturnal_formula) == 3:
            tmp_codes = []
            for tok in raw_nocturnal_formula:
                if isinstance(tok, int):
                    tmp_codes.append(tok)
                elif isinstance(tok, str) and tok in NAME_TO_CODE:
                    tmp_codes.append(NAME_TO_CODE[tok])
                else:
                    tmp_codes = None
                    break
            if tmp_codes is not None:
                nocturnal_codes = tuple(tmp_codes)
                raw_nocturnal_refdeg = item.get('nocturnal_refdeg', [0, 0, 0])
                if not isinstance(raw_nocturnal_refdeg, list) or len(raw_nocturnal_refdeg) != 3:
                    raw_nocturnal_refdeg = [0, 0, 0]
                tmp_trip = []
                for i, v in enumerate(raw_nocturnal_refdeg):
                    if isinstance(v, (list, dict)) and nocturnal_codes[i] in _RE_CODES:
                        tmp_trip.append(_parse_embedded(v))
                    elif isinstance(v, str) and nocturnal_codes[i] in _RE_CODES:
                        tmp_trip.append(0)
                    else:
                        try:
                            tmp_trip.append(int(v))
                        except (ValueError, TypeError):
                            tmp_trip.append(0)
                nocturnal_trip = tuple(tmp_trip)

        new_items.append(build_part_tuple(
            name, codes, diurnal, trip, active=active, gendered=gendered,
            female_codes=female_codes, female_refdeg=female_trip,
            nocturnal_codes=nocturnal_codes, nocturnal_refdeg=nocturnal_trip))
        names.add(name)
        count += 1
        added += 1
        if has_name_refs:
            deferred_refs.append((len(new_items) - 1, tuple(codes), raw_refdeg))

    # Pass 2: keep name-based RE references as name strings when the
    # referenced lot exists (arabicpartsdlg.py:2632-2650).
    unresolved = 0
    for idx, codes, raw_refdeg in deferred_refs:
        item = list(new_items[idx])
        trip = list(item[3])
        for i in range(3):
            if codes[i] in _RE_CODES and isinstance(raw_refdeg[i], str):
                if raw_refdeg[i] in names:
                    trip[i] = raw_refdeg[i]
                else:
                    unresolved += 1
        item[3] = tuple(trip)
        new_items[idx] = tuple(item)

    return new_items, added, skipped, unresolved


def format_lof_formula_text(lof_type, abovehorizon=True):
    asc = mtexts.partstxts[ArabicParts.ASC] if 'partstxts' in dir(mtexts) and ArabicParts.ASC < len(mtexts.partstxts) else u'Asc'
    sun = mtexts.partstxts[ArabicParts.SUN] if 'partstxts' in dir(mtexts) and ArabicParts.SUN < len(mtexts.partstxts) else u'Sun'
    moon = mtexts.partstxts[ArabicParts.MOON] if 'partstxts' in dir(mtexts) and ArabicParts.MOON < len(mtexts.partstxts) else u'Moon'
    try:
        if lof_type == chart.Chart.LFMOONSUN:
            return u'%s + %s - %s' % (asc, moon, sun)
        if lof_type == chart.Chart.LFDSUNMOON:
            if abovehorizon:
                return u'%s + %s - %s' % (asc, sun, moon)
            return u'%s + %s - %s' % (asc, moon, sun)
        if lof_type == chart.Chart.LFDMOONSUN:
            if abovehorizon:
                return u'%s + %s - %s' % (asc, moon, sun)
            return u'%s + %s - %s' % (asc, sun, moon)
    except Exception:
        return None
    return None

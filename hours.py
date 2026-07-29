# -*- coding: utf-8 -*-
import astrology
import util
import math
# The geometric sunrise/sunset solver now lives wx-free in engine.paranatellonta
# (relocated verbatim from paranwnd.py). Import from there so hours.py — which is
# pulled into chart construction and the daemon — no longer drags the wx GUI
# module paranwnd in.
from engine.paranatellonta import _sunrise_sunset_for_local_day_geometric as sunrise_sunset_ut
from engine.paranatellonta import _sunrise_span_for_local_day           as sunrise_span_ut

class PlanetaryHours:
    #From sunrise!! (till next sunrise)
    #Monday: Moon, Saturnus, Jupiter, Mars, Sun, Venus, Mercury, Moon...
    #Sunday: Sun, Venus, Mercury, Moon, Saturnus, Jupiter, Mars, Sun...
    PHs = ((1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5),
            (4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3),
            (2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6),
            (5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0),
            (3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1),
            (6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4),
            (0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2, 1, 6, 5, 4, 0, 3, 2))


    def __init__(self, lon, lat, altitude, weekday, jd, tz_hours):
        offs = float(tz_hours) / 24.0
        self.risetime = None
        self.settime = None
        self.hrlen = None
        self.daytime = None

        self.weekday = weekday

        #lon, lat, height, atmpress, celsius
        #in GMT, searches after jd!
        rise_flags = (
            astrology.SE_CALC_RISE |
            astrology.SE_BIT_DISC_CENTER |
            astrology.SE_BIT_NO_REFRACTION
        )
        set_flags = (
            astrology.SE_CALC_SET |
            astrology.SE_BIT_DISC_CENTER |
            astrology.SE_BIT_NO_REFRACTION
        )
        ret, risetime, serr = astrology.swe_rise_trans(jd, astrology.SE_SUN, '', astrology.SEFLG_SWIEPH,
            rise_flags,
            lon, lat, float(altitude), 0.0, 0.0)

#		self.logCalc(risetime)#
        ret, settime, serr = astrology.swe_rise_trans(jd, astrology.SE_SUN, '', astrology.SEFLG_SWIEPH,
            set_flags,
            lon, lat, float(altitude), 0.0, 0.0)

#		self.logCalc(settime)#

        #swe_rise_trans calculates only forward!!
        #offs = lon*4.0/1440.0
        hr = 0
        HOURSPERHALFDAY = 12.0
        if risetime > settime: # daytime
            self.daytime = True
#			print 'daytime'#
            # Anchor the preceding sunrise from the already-resolved upcoming
            # sunset.  Searching from jd-1 can briefly select yesterday's
            # sunrise when consecutive sunrise times differ by a few seconds.
            ret, self.risetime, serr = astrology.swe_rise_trans(settime-1.0, astrology.SE_SUN, '', astrology.SEFLG_SWIEPH,
                rise_flags,
                lon, lat, float(altitude), 0.0, 0.0)

#			self.logCalc(risetime)#
            self.settime = settime

            #From GMT to Local
            self.risetime += offs
            self.settime += offs

#			self.logCalc(settime)#
            self.hrlen = (self.settime-self.risetime)/HOURSPERHALFDAY #hrlen(hour-length) is in days
            for i in range(int(HOURSPERHALFDAY)):
                if jd+offs < self.risetime+self.hrlen*(i+1):
                    hr = i
                    break
        else:# nighttime
            self.daytime = False
#			print 'nightime'#
            self.risetime = risetime
#			self.logCalc(risetime)#
            # The next sunrise is a stable anchor for the preceding sunset.
            # This avoids the same one-day seasonal-drift ambiguity at dusk.
            ret, self.settime, serr = astrology.swe_rise_trans(
                risetime-1.0, astrology.SE_SUN, '', astrology.SEFLG_SWIEPH,
                set_flags, lon, lat, float(altitude), 0.0, 0.0)
#			self.logCalc(settime)#

            #From GMT to Local
            self.risetime += offs
            self.settime += offs

            #Is the local birthtime greater than midnight? If so => decrement day because a planetary day is from sunrise to sunrise
            if jd+offs > int(jd+offs)+0.5:
                self.weekday = util.getPrevDay(self.weekday)

            self.hrlen = (self.risetime-self.settime)/HOURSPERHALFDAY
            for i in range(int(HOURSPERHALFDAY)):
                if jd+offs < self.settime+self.hrlen*(i+1):
                    hr = i+int(HOURSPERHALFDAY)
                    break

        self.planetaryhour = PlanetaryHours.PHs[self.weekday][hr]#planetary day begins from sunrise(not from 0 hour and Planetary hours are not equal!!)
#		print 'planetary hour is: %d' % self.planetaryhour#


    def revTime(self, tjd):
        jy, jm, jd, jh = astrology.swe_revjul(tjd, 1)
        d, m, s = util.decToDeg(jh)
        return (d, m, s)

        
    def logCalc(self, tjd):
        #in GMT!
        jy, jm, jd, jh = astrology.swe_revjul(tjd, 1)
        d, m, s = util.decToDeg(jh)
        print ('GMT: %d.%d.%d %d:%d:%d' % (jy,jm,jd, d, m, s))

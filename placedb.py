import os
import sys
import pickle


class PlaceDB:

	class Record:
		NAME = 0
		LON = 1
		LAT = 2
		TZ = 3
		ALT = 4
		MAX_NUM = ALT

		DELIMITER = '\t'
		DELIMITER_NUM = MAX_NUM

		def __init__(self, name, lon, lat, tz, alt):
			self.name = name
			self.lon = lon
			self.lat = lat
			self.tz = tz
			self.alt = alt

	# Bundled factory copy (read-only fallback / migration source)
	FACTORY_FILENAME = os.path.join('Res', 'placedb.dat')

	@staticmethod
	def _resolve_user_path():
		home = os.path.expanduser('~')
		if sys.platform == 'darwin':
			base = os.path.join(home, 'Library', 'Application Support', 'Morinus')
		else:
			appdata = os.environ.get('APPDATA')
			if appdata:
				base = os.path.join(appdata, 'Morinus')
			else:
				xdg = os.environ.get('XDG_CONFIG_HOME') or os.path.join(home, '.config')
				base = os.path.join(xdg, 'Morinus')
		return os.path.join(base, 'placedb.dat')

	def __init__(self):
		self.placedb = []

	def add(self, name, lon, lat, tz, alt):
		self.placedb.append(PlaceDB.Record(name, lon, lat, tz, alt))

	def _load_from(self, path):
		lines = []
		with open(path, 'rb') as f:
			try:
				while True:
					lines.append(pickle.load(f))
			except EOFError:
				pass
		seen = set()
		for ln in lines:
			ln = ln.rstrip('\n')
			if not self.isValid(ln):
				continue
			line = ln.split(PlaceDB.Record.DELIMITER)
			name = line[PlaceDB.Record.NAME]
			if name in seen:
				continue
			seen.add(name)
			self.placedb.append(PlaceDB.Record(
				name, line[PlaceDB.Record.LON],
				line[PlaceDB.Record.LAT], line[PlaceDB.Record.TZ],
				line[PlaceDB.Record.ALT],
			))

	def read(self):
		user_path = PlaceDB._resolve_user_path()
		if os.path.exists(user_path):
			try:
				self._load_from(user_path)
				return
			except Exception:
				pass
		# Fall back to bundled copy (first run or missing user file)
		try:
			self._load_from(PlaceDB.FACTORY_FILENAME)
		except Exception:
			pass

	def write(self):
		user_path = PlaceDB._resolve_user_path()
		try:
			os.makedirs(os.path.dirname(user_path), exist_ok=True)
			with open(user_path, 'wb') as f:
				for rec in self.placedb:
					txt = (rec.name + PlaceDB.Record.DELIMITER + rec.lon + PlaceDB.Record.DELIMITER +
						rec.lat + PlaceDB.Record.DELIMITER + rec.tz + PlaceDB.Record.DELIMITER + rec.alt + '\n')
					pickle.dump(txt, f)
		except IOError:
			pass
		

	def sort(self):
		self.placedb = self.qsort(self.placedb)

#		num = len(self.placedb)

#		for j in range(num):
#			for i in range(num-1):
#				if (self.placedb[i].name > self.placedb[i+1].name):
#					tmp = self.placedb[i]
#					self.placedb[i] = self.placedb[i+1]
#					self.placedb[i+1] = tmp


	def qsort(self, L):
		if L == []: return []
		return self.qsort([x for x in L[1:] if x.name < L[0].name]) + L[0:1] + self.qsort([x for x in L[1:] if x.name >= L[0].name])



	def isValid(self, ln):
		valid = True
		if ln == '':
			valid = False
		else:
			if ln.count(PlaceDB.Record.DELIMITER) != PlaceDB.Record.DELIMITER_NUM:
				valid = False
			#else #here can be more checking...

		return valid




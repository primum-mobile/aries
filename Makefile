.PHONY: exe clean

PYTHON ?= python3
PYINSTALLER ?= PyInstaller
SPEC ?= Morinus.spec
SWEP_SRC ?= SWEP/src
DISTDIR ?= dist-windows
WORKDIR ?= build-windows

build-ext:
	cd $(SWEP_SRC) && $(PYTHON) setup.py build_ext --inplace

exe: build-ext
	@test -f sweastrology.pyd || { echo "Missing sweastrology.pyd after build-ext."; exit 1; }
	$(PYTHON) -m $(PYINSTALLER) --clean --distpath $(DISTDIR) --workpath $(WORKDIR) $(SPEC)

clean:
	rm -rf build dist $(DISTDIR) $(WORKDIR) __pycache__

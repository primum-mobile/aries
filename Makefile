.PHONY: build-ext exe clean

PYTHON ?= python3
PYINSTALLER ?= PyInstaller
SPEC ?= Morinus.spec
SWEP_SRC ?= SWEP/src
DISTDIR ?= dist-windows
WORKDIR ?= build-windows

build-ext:
	cd $(SWEP_SRC) && $(PYTHON) setup.py build_ext --inplace

exe: build-ext
	@find "$(SWEP_SRC)" -maxdepth 1 \( -name 'sweastrology*.pyd' -o -name 'sweastrology*.so' \) | grep -q . || { echo "Missing sweastrology binary after build-ext."; exit 1; }
	$(PYTHON) -m $(PYINSTALLER) --clean --distpath $(DISTDIR) --workpath $(WORKDIR) $(SPEC)

clean:
	rm -rf build dist $(DISTDIR) $(WORKDIR) __pycache__

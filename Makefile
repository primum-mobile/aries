.PHONY: build-ext exe clean macos-x86_64 macos-arm64 macos-universal macos-release

# POSIX-oriented helper targets.
# On native Windows shells, prefer direct `python` / PowerShell commands.

PYTHON ?= python3
PYINSTALLER ?= PyInstaller
SPEC ?= Morinus.spec
SWEP_SRC ?= SWEP/src
DISTDIR ?= dist-windows
WORKDIR ?= build-windows
MACOS_BUILD_SCRIPT ?= ./scripts/build_macos_app.sh
MACOS_RELEASE_SCRIPT ?= ./scripts/build_macos_release.sh

build-ext:
	cd $(SWEP_SRC) && $(PYTHON) setup.py build_ext --inplace

exe: build-ext
	@find "$(SWEP_SRC)" -maxdepth 1 \( -name 'sweastrology*.pyd' -o -name 'sweastrology*.so' \) | grep -q . || { echo "Missing sweastrology binary after build-ext."; exit 1; }
	$(PYTHON) -m $(PYINSTALLER) --clean --distpath $(DISTDIR) --workpath $(WORKDIR) $(SPEC)

macos-x86_64:
	$(MACOS_BUILD_SCRIPT) x86_64

macos-arm64:
	$(MACOS_BUILD_SCRIPT) arm64

macos-universal:
	$(MACOS_BUILD_SCRIPT) universal

macos-release:
	$(MACOS_RELEASE_SCRIPT)

clean:
	rm -rf build dist $(DISTDIR) $(WORKDIR) __pycache__

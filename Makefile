.DEFAULT_GOAL := help

.PHONY: help run check package build-ext clean web web-browser-smoke web-tauri web-tauri-status web-tauri-test-frontend
.PHONY: web-tauri-stop web-tauri-reset web-live-smoke web-daemon web-dev
.PHONY: perf-check perf-report speedlog
.PHONY: worktree-check worktree-bootstrap
.PHONY: web-frontend web-hosted-build web-notes web-corpus web-runtime-resources web-legal web-venv web-build-deps web-check-deps
.PHONY: app-preflight web-frontend-preflight web-tauri-before-build
.PHONY: web-daemon-current web-daemon-binary web-verify-parity style-check style-token-check
.PHONY: web-dev-runtime web-venv-python
# These targets expect a POSIX shell (macOS, Linux, Git Bash); the Windows
# installer is built by the Tauri Windows configuration's PowerShell prebuild.
# PYTHON runs stdlib-only helper scripts. Everything that needs third-party
# packages (setuptools, Pillow, PyInstaller, pytest, the daemon requirements)
# runs through WEB_PYTHON, the project venv, whose requirements declare them.
# ARIES_PYTHON is the one interpreter that creates that venv; set it to choose
# the Python version (e.g. ARIES_PYTHON=python3.14). An existing venv made by
# another minor version is refused rather than mixed.
PYTHON ?= python3
ARIES_PYTHON ?= python3
SWEP_SRC ?= SWEP/src
WEB_DAEMON_PORT ?= 8765
WEB_VENV := webapp/.venv
WEB_PYTHON ?= $(WEB_VENV)/bin/python
ARCH ?= arm64
ARIES_VERSION ?=
# Private/development builds stage every authored corpus pack that exists in the
# checkout. Valens is passive public inspector content; the other packs provide
# interpretation rules and remain subject to the release distribution boundary.
ARIES_PACK_SEED_SOURCES ?= $(wildcard corpus/valens corpus/hephaistion corpus/dorotheus corpus/lilly corpus/robson-fixed-stars)
PUBLIC_MACOS_ICON := Res/OpenAries.icns
PUBLIC_TAURI_ICON_CONFIG := {"bundle":{"icon":["../../../$(PUBLIC_MACOS_ICON)","icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.ico"]}}
export ARIES_VERSION

DAEMON_BUILD_STAMP := webapp/frontend/.tmp/daemon-build.stamp
DAEMON_BUILD_INPUTS := Makefile scripts/build_sweastrology.sh scripts/build_transit_kernel.py
DAEMON_BUILD_INPUTS += webapp/frontend/src/lib/chart/wheel-ring-archetypes.json
DAEMON_BUILD_INPUTS += webapp/frontend/src/lib/chart/dignity-display-policy.json
DAEMON_BUILD_INPUTS += $(wildcard webapp/frontend/src/lib/chart/wheel-factory-*.json)
DAEMON_BUILD_INPUTS += webapp/frontend/src/lib/chart/wheel-geometry-ownership.json
DAEMON_BUILD_INPUTS += webapp/daemon/shipping-style-profiles.json
DAEMON_BUILD_INPUTS += scripts/binary_archs.py

# Portable stand-in for `lipo -archs` (Mach-O, ELF and PE), and the daemon
# interpreter's architecture normalized to the same names (arm64, x86_64).
BINARY_ARCHS = $(PYTHON) scripts/binary_archs.py
DAEMON_ARCH = $(BINARY_ARCHS) --normalize "$$($(WEB_PYTHON) -c 'import platform; print(platform.machine())')"
DAEMON_BUILD_INPUTS += $(wildcard *.py)
DAEMON_BUILD_INPUTS += $(shell find aries engine forecasting parsers rectification SWEP/src webapp/daemon webapp/frontend/scripts webapp/interface \
	-type f \( -name '*.py' -o -name '*.pyx' -o -name '*.pxd' -o -name '*.c' -o -name '*.h' -o -name '*.spec' \) \
	-not -path '*/__pycache__/*' 2>/dev/null)

# Public command surface. Owner-only signing and release targets are loaded from
# ops/ in the private workspace and are intentionally absent from source exports.
help:
	@printf '%s\n' \
		'Aries commands:' \
		'  make run    Open the native development app' \
		'  make check  Run public static and backend checks' \
		'  make package  Build an unlocked, unsigned local package' \
		'  make web    Build and smoke-test the browser (WASM) app'
	@if [ -n "$(ARIES_OWNER_RELEASE)" ]; then \
		$(MAKE) --no-print-directory owner-help; \
	fi

run: worktree-check web-dev-runtime
	cd webapp/frontend && bash ./scripts/tauri-dev-up.sh

# Debug Tauri runs source Python. Only changed native code needs compilation;
# PyInstaller and the release sidecar are exclusively packaging prerequisites.
web-dev-runtime: web-venv-python
	$(WEB_PYTHON) -m webapp.daemon.dev_runtime

check: build-ext web-corpus web-runtime-resources web-legal web-check-deps web-tauri-test-frontend
	cd webapp/frontend && npm run lint
	cd webapp/frontend && npm run typecheck
	cd webapp/frontend && npm test
	cd webapp/frontend/src-tauri && cargo test
	@if find tests aries -type f -name 'test_*.py' -print -quit 2>/dev/null | grep -q .; then \
		PYTHONPATH=$(SWEP_SRC) $(WEB_PYTHON) -m pytest -q \
			aries/astrology/transit_fast/tests tests/test_public_readme_shortcuts.py \
			tests/test_binary_archs.py; \
	else \
		printf '%s\n' 'No Python tests in this source export; running static checks only.'; \
	fi
	$(WEB_PYTHON) -m compileall -q *.py aries engine parsers webapp/daemon \
		scripts/stage_corpus_resources.py scripts/stage_tauri_runtime_resources.py \
		scripts/stage_tauri_legal_artifacts.py

perf-check:
	@curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 || { \
		printf '%s\n' 'Aries is not running. Run make run, then make perf-check.' >&2; \
		exit 1; \
	}
	@cd webapp/frontend; \
	STATUS=0; \
	npm run perf:chart-step || STATUS=$$?; \
	npm run perf:report || { [ $$STATUS -ne 0 ] || STATUS=$$?; }; \
	exit $$STATUS

perf-report:
	cd webapp/frontend && npm run perf:report

speedlog:
	@LOG_PATH="$$($(PYTHON) -c 'import tempfile; print(tempfile.gettempdir() + "/aries-speedlog.jsonl")')"; \
	if [ -f "$$LOG_PATH" ]; then tail -n 20 "$$LOG_PATH"; else printf '%s\n' "No automatic speedlog yet: $$LOG_PATH"; fi

worktree-check:
	@$(PYTHON) scripts/worktree_runtime.py check

worktree-bootstrap:
	@$(PYTHON) scripts/worktree_runtime.py bootstrap

# Native extensions compile with the venv's setuptools (requirements-build.txt).
build-ext: web-build-deps
	cd $(SWEP_SRC) && $(abspath $(WEB_PYTHON)) setup.py build_ext --inplace
	$(WEB_PYTHON) scripts/build_transit_kernel.py build_ext --inplace

# Creates the project venv with ARIES_PYTHON. It does not see the interpreter's
# own site-packages: every package comes from the declared requirements, since
# a system Pillow or setuptools can vanish or break when Python is upgraded.
# A custom WEB_PYTHON (such as an Intel packaging venv) must already exist.
web-venv-python:
	@if [ "$(WEB_PYTHON)" != "$(WEB_VENV)/bin/python" ]; then \
		[ -x "$(WEB_PYTHON)" ] || { echo "Missing WEB_PYTHON=$(WEB_PYTHON)" >&2; exit 1; }; \
		exit 0; \
	fi; \
	minor='import sys; print("%d.%d" % sys.version_info[:2])'; \
	wanted=$$($(ARIES_PYTHON) -c "$$minor" 2>/dev/null) || { \
		echo "ARIES_PYTHON=$(ARIES_PYTHON) does not run; set ARIES_PYTHON to the Python for $(WEB_VENV)." >&2; \
		exit 1; \
	}; \
	if [ -x "$(WEB_PYTHON)" ]; then \
		have=$$($(WEB_PYTHON) -c "$$minor" 2>/dev/null) || have=unknown; \
		[ "$$have" = "$$wanted" ] && exit 0; \
		printf '%s\n' \
			"$(WEB_VENV) was made by Python $$have, but ARIES_PYTHON=$(ARIES_PYTHON) is Python $$wanted." \
			"Keep the venv with ARIES_PYTHON=python$$have, or delete $(WEB_VENV) to rebuild it with $(ARIES_PYTHON)." >&2; \
		exit 1; \
	fi; \
	if [ -e "$(WEB_VENV)" ] || [ -L "$(WEB_VENV)" ]; then \
		echo "$(WEB_VENV) has no working Python; delete it to rebuild it with $(ARIES_PYTHON)." >&2; \
		exit 1; \
	fi; \
	echo "Creating $(WEB_VENV) with $(ARIES_PYTHON) (Python $$wanted)"; \
	$(ARIES_PYTHON) -m venv $(WEB_VENV)

web-venv: web-venv-python
	$(WEB_PYTHON) -m pip install -r webapp/daemon/requirements.txt

web-daemon: web-venv
	$(WEB_PYTHON) -m uvicorn webapp.daemon.server:app --host 127.0.0.1 --port $(WEB_DAEMON_PORT)

web-notes:
	cd notes_web && npm run build

web-corpus:
	$(PYTHON) scripts/stage_corpus_resources.py corpus/parsed webapp/frontend/src-tauri/target/aries-corpus-resources --subdir parsed
	$(PYTHON) scripts/stage_corpus_pack_seed.py webapp/frontend/src-tauri/target/aries-pack-seeds $(ARIES_PACK_SEED_SOURCES)

# tauri-build checks at compile time that frontendDist and every bundle resource
# exist. `cargo test` needs neither the built frontend nor its media, so create
# the two staged directories empty when no build has staged them; a real
# web-tauri-before-build stage is never touched.
web-tauri-test-frontend:
	mkdir -p webapp/frontend/src-tauri/target/aries-frontend-embedded \
		webapp/frontend/src-tauri/target/aries-frontend-media

web-runtime-resources:
	$(PYTHON) scripts/stage_tauri_runtime_resources.py

web-legal: web-build-deps
	$(PYTHON) scripts/stage_tauri_legal_artifacts.py --web-python $(WEB_PYTHON)

web-frontend: web-notes
	cd webapp/frontend && NEXT_PUBLIC_ARIES_DAEMON_URL=http://127.0.0.1:$(WEB_DAEMON_PORT) npm run dev

web-hosted-build: web-notes
	cd webapp/frontend && NEXT_PUBLIC_ARIES_DAEMON_URL=same-origin npm run build

# Fail on frontend contract drift before spending time rebuilding the native
# daemon and staging package resources. Tauri invokes the complete ordered
# producer below for both direct and Makefile-driven package builds.
web-frontend-preflight:
	cd webapp/frontend && npm run prebuild

# Shared by the private push guard and app builds. Owner tooling adds the full
# localization gate to web-frontend-preflight without leaking private scanners
# into the public source export.
app-preflight: web-frontend-preflight

web-tauri-before-build: web-frontend-preflight
	$(MAKE) --no-print-directory web-corpus web-notes web-daemon-binary web-legal
	@# Universal builds: fuse the native daemon with the Intel one built beforehand.
	@if [ -n "$$ARIES_UNIVERSAL_X86_DAEMON" ]; then \
		stage=webapp/.pyinstaller-universal; daemon=webapp/frontend/src-tauri/binaries/aries-daemon; \
		rm -rf $$stage/arm64 && ditto $$daemon $$stage/arm64 && \
		$(WEB_PYTHON) scripts/fuse_macos_universal.py $$stage/arm64 "$$ARIES_UNIVERSAL_X86_DAEMON" $$stage/universal && \
		find $$daemon -mindepth 1 ! -name .gitkeep -exec rm -rf {} + && ditto $$stage/universal $$daemon && \
		$$daemon/aries-daemon --verify-native-transit-kernel && \
		/usr/bin/arch -x86_64 $$daemon/aries-daemon --verify-native-transit-kernel && \
		echo "Daemon bundle at $$daemon (universal)" || exit 1; \
	fi
	$(PYTHON) scripts/stage_tauri_runtime_resources.py
	cd webapp/frontend && npm run build:next
	@# Embed a pruned frontend; fonts and plates ship once as bundle resources.
	$(PYTHON) scripts/stage_tauri_frontend_dist.py

web-dev: web-venv web-notes
	@set -e; \
	$(WEB_PYTHON) -m uvicorn webapp.daemon.server:app --host 127.0.0.1 --port $(WEB_DAEMON_PORT) & \
	DAEMON_PID=$$!; \
	trap 'kill $$DAEMON_PID 2>/dev/null || true' EXIT INT TERM; \
	cd webapp/frontend && NEXT_PUBLIC_ARIES_DAEMON_URL=http://127.0.0.1:$(WEB_DAEMON_PORT) npm run dev

# Persistent Aries desktop dev app. Starts `tauri dev` detached and leaves it
# running across development sessions; rerunning is idempotent.
web-tauri:
	cd webapp/frontend && bash ./scripts/tauri-dev-up.sh

style-token-check:
	cd webapp/frontend && npm run style-token-check

style-check:
	cd webapp/frontend && npm run style-check

web-tauri-status:
	cd webapp/frontend && bash ./scripts/tauri-dev-status.sh

web-tauri-stop:
	cd webapp/frontend && bash ./scripts/tauri-dev-stop.sh

# Destructive fallback when the persistent Tauri stack is wedged. Frees ports
# 3000 + the daemon port so Tauri can spawn a clean frontend + daemon pair.
web-tauri-reset: web-venv
	@echo "Freeing ports 3000 (frontend) + $(WEB_DAEMON_PORT) (daemon)..."; \
	( lsof -ti tcp:3000; lsof -ti tcp:$(WEB_DAEMON_PORT) ) 2>/dev/null | sort -u | xargs kill -9 2>/dev/null || true; \
	cd webapp/frontend && bash ./scripts/tauri-dev-stop.sh; \
	bash ./scripts/tauri-dev-up.sh

# Non-destructive smoke for a live Aries dev session. Probes the existing
# frontend + daemon; starts/stops nothing.
web-live-smoke:
	cd webapp/frontend && bash ./scripts/live-smoke.sh

web-build-deps: web-venv
	$(WEB_PYTHON) -m pip install -r webapp/daemon/requirements-build.txt

web-check-deps: web-build-deps
	$(WEB_PYTHON) -m pip install -r requirements-dev.txt

$(DAEMON_BUILD_STAMP): $(DAEMON_BUILD_INPUTS)
	@echo "Daemon sources changed; rebuilding native sidecar..."
	@$(MAKE) --no-print-directory web-daemon-binary

web-daemon-current: $(DAEMON_BUILD_STAMP)

web-daemon-binary: web-build-deps
	@ARCH=$$($(DAEMON_ARCH)); \
	case "$$ARCH" in arm64|x86_64) ;; *) echo "Unsupported daemon Python arch: $$ARCH" >&2; exit 1 ;; esac; \
	PYTHON_BIN="$(WEB_PYTHON)" ./scripts/build_sweastrology.sh "$$ARCH"; \
	SWE_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("sweastrology" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	SWE_ARCHS=$$($(BINARY_ARCHS) "$$SWE_SO" 2>/dev/null || true); \
	case " $$SWE_ARCHS " in *" $$ARCH "*) ;; *) echo "$$SWE_SO has architecture(s) '$$SWE_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	KERNEL_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("aries/astrology/transit_fast/_transit_kernel" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	KERNEL_ARCHS=$$($(BINARY_ARCHS) "$$KERNEL_SO" 2>/dev/null || true); \
	case " $$KERNEL_ARCHS " in *" $$ARCH "*) ;; *) echo "$$KERNEL_SO has architecture(s) '$$KERNEL_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	$(WEB_PYTHON) -c 'from aries.astrology.transit_fast import api; assert api.native_backend_available(), "native transit kernel import failed"'
	$(WEB_PYTHON) -m PyInstaller webapp/daemon/aries-daemon.spec --clean --noconfirm --workpath webapp/.pyinstaller-build --distpath webapp/.pyinstaller-dist
	@ARCH=$$($(DAEMON_ARCH)); \
	if [ "$$ARCH" = "arm64" ]; then CPU=aarch64; else CPU=x86_64; fi; \
	case "$$(uname -s)" in Darwin) TRIPLE=$$CPU-apple-darwin ;; Linux) TRIPLE=$$CPU-unknown-linux-gnu ;; *) TRIPLE=$$CPU-unknown ;; esac; \
	mkdir -p webapp/frontend/src-tauri/binaries; \
	mkdir -p webapp/frontend/src-tauri/binaries/aries-daemon; \
	find webapp/frontend/src-tauri/binaries/aries-daemon -mindepth 1 ! -name .gitkeep -exec rm -rf {} +; \
	rm -f webapp/frontend/src-tauri/binaries/aries-daemon-aarch64-apple-darwin webapp/frontend/src-tauri/binaries/aries-daemon-x86_64-apple-darwin; \
	cp -R webapp/.pyinstaller-dist/aries-daemon/. webapp/frontend/src-tauri/binaries/aries-daemon/; \
	SWE_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("sweastrology" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	DAEMON_ARCHS=$$($(BINARY_ARCHS) webapp/frontend/src-tauri/binaries/aries-daemon/_internal/$$SWE_SO 2>/dev/null || true); \
	case " $$DAEMON_ARCHS " in *" $$ARCH "*) ;; *) echo "Bundled $$SWE_SO has architecture(s) '$$DAEMON_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	KERNEL_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("_transit_kernel" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	KERNEL_PATH=webapp/frontend/src-tauri/binaries/aries-daemon/_internal/aries/astrology/transit_fast/$$KERNEL_SO; \
	KERNEL_ARCHS=$$($(BINARY_ARCHS) "$$KERNEL_PATH" 2>/dev/null || true); \
	case " $$KERNEL_ARCHS " in *" $$ARCH "*) ;; *) echo "Bundled $$KERNEL_SO has architecture(s) '$$KERNEL_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	webapp/frontend/src-tauri/binaries/aries-daemon/aries-daemon --verify-native-transit-kernel; \
	echo "Daemon bundle at webapp/frontend/src-tauri/binaries/aries-daemon ($$TRIPLE)"
	@mkdir -p $(dir $(DAEMON_BUILD_STAMP))
	@touch $(DAEMON_BUILD_STAMP)

web-verify-parity: web-venv
	@$(WEB_PYTHON) -m uvicorn webapp.daemon.server:app --host 127.0.0.1 --port $(WEB_DAEMON_PORT) & \
	DAEMON_PID=$$!; \
	trap 'kill $$DAEMON_PID 2>/dev/null || true' EXIT INT TERM; \
	sleep 2; \
	$(WEB_PYTHON) webapp/daemon/verify_parity.py

# The unlocked source build has its own public identity. Owner-only signed
# builds do not use this target and continue to package Res/Aries.icns.
package:
	@test -f "$(PUBLIC_MACOS_ICON)" || { echo "Missing public app icon: $(PUBLIC_MACOS_ICON)" >&2; exit 1; }
	cd webapp/frontend && ARIES_LICENSE_REQUIRED=0 npx tauri build --config '$(PUBLIC_TAURI_ICON_CONFIG)'

# Browser build (aries.sh/webapp): the same daemon, engine and frontend as the
# desktop app, compiled for WebAssembly. Prepares the toolchain on first use,
# smoke-tests the engine headless, then writes build/wasm/site.
web:
	bash scripts/wasm/setup_toolchain.sh
	$(PYTHON) scripts/wasm/stage_engine.py
	node scripts/wasm/smoke.mjs
	$(PYTHON) scripts/wasm/build_web.py

# Headless Chromium against build/wasm/site (run `make web` first): the page
# loads, the engine boots, Here and Now renders, a time step repaints, and no
# console errors. Uses the frontend's Playwright (npx playwright install chromium).
web-browser-smoke:
	PYTHON=$(PYTHON) node scripts/wasm/browser_smoke.mjs

clean:
	rm -rf build dist __pycache__

# These fragments exist only in the private workspace. The public Makefile is
# complete without them and never needs release credentials.
-include ops/owner-development.mk
-include ops/owner-release.mk

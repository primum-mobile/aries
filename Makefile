.DEFAULT_GOAL := help

.PHONY: help run check package build-ext clean web web-tauri web-tauri-status
.PHONY: web-tauri-stop web-tauri-reset web-live-smoke web-daemon web-dev
.PHONY: perf-check perf-report speedlog
.PHONY: worktree-check worktree-bootstrap
.PHONY: web-frontend web-hosted-build web-notes web-corpus web-runtime-resources web-legal web-venv web-build-deps web-check-deps
.PHONY: web-daemon-current web-daemon-binary web-verify-parity style-check style-token-check

# POSIX-oriented helper targets.
# On native Windows shells, prefer direct `python` / PowerShell commands.

PYTHON ?= python3
SWEP_SRC ?= SWEP/src
WEB_DAEMON_PORT ?= 8765
WEB_PYTHON ?= webapp/.venv/bin/python
ARCH ?= arm64
ARIES_VERSION ?=
ARIES_PACK_SEED_SOURCES ?=
export ARIES_VERSION

DAEMON_BUILD_STAMP := webapp/frontend/.tmp/daemon-build.stamp
DAEMON_BUILD_INPUTS := Makefile scripts/build_sweastrology.sh scripts/build_transit_kernel.py
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
		'  make package  Build an unlocked, unsigned local package'
	@if [ -n "$(ARIES_OWNER_RELEASE)" ]; then \
		$(MAKE) --no-print-directory owner-help; \
	fi

run: worktree-check web-daemon-current
	@if [ ! -x webapp/frontend/src-tauri/binaries/aries-daemon/aries-daemon ]; then \
		$(MAKE) web-daemon-binary; \
	fi
	cd webapp/frontend && bash ./scripts/tauri-dev-up.sh

check: build-ext web-corpus web-runtime-resources web-legal web-check-deps
	cd webapp/frontend && npm run lint
	cd webapp/frontend && npm run typecheck
	cd webapp/frontend && npm test
	cd webapp/frontend/src-tauri && cargo test
	@if find tests aries -type f -name 'test_*.py' -print -quit 2>/dev/null | grep -q .; then \
		PYTHONPATH=$(SWEP_SRC) $(WEB_PYTHON) -m pytest -q \
			aries/astrology/transit_fast/tests tests/test_public_readme_shortcuts.py; \
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

build-ext:
	cd $(SWEP_SRC) && $(PYTHON) setup.py build_ext --inplace
	$(PYTHON) scripts/build_transit_kernel.py build_ext --inplace

web-venv:
	@if [ ! -x "$(WEB_PYTHON)" ]; then \
		if [ "$(WEB_PYTHON)" = "webapp/.venv/bin/python" ]; then \
			$(PYTHON) -m venv --system-site-packages webapp/.venv; \
		else \
			echo "Missing WEB_PYTHON=$(WEB_PYTHON)" >&2; \
			exit 1; \
		fi; \
	fi
	$(WEB_PYTHON) -m pip install -r webapp/daemon/requirements.txt

web-daemon: web-venv
	$(WEB_PYTHON) -m uvicorn webapp.daemon.server:app --host 127.0.0.1 --port $(WEB_DAEMON_PORT)

web-notes:
	cd notes_web && npm run build

web-corpus:
	$(PYTHON) scripts/stage_corpus_resources.py corpus/parsed webapp/frontend/src-tauri/target/aries-corpus-resources --subdir parsed
	$(PYTHON) scripts/stage_corpus_pack_seed.py webapp/frontend/src-tauri/target/aries-pack-seeds $(ARIES_PACK_SEED_SOURCES)

web-runtime-resources:
	$(PYTHON) scripts/stage_tauri_runtime_resources.py

web-legal: web-build-deps
	$(PYTHON) scripts/stage_tauri_legal_artifacts.py --web-python $(WEB_PYTHON)

web-frontend: web-notes
	cd webapp/frontend && NEXT_PUBLIC_ARIES_DAEMON_URL=http://127.0.0.1:$(WEB_DAEMON_PORT) npm run dev

web-hosted-build: web-notes
	cd webapp/frontend && NEXT_PUBLIC_ARIES_DAEMON_URL=same-origin npm run build

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
	@ARCH=$$($(WEB_PYTHON) -c 'import platform; print(platform.machine())'); \
	case "$$ARCH" in arm64|x86_64) ;; *) echo "Unsupported daemon Python arch: $$ARCH" >&2; exit 1 ;; esac; \
	PYTHON_BIN="$(WEB_PYTHON)" ./scripts/build_sweastrology.sh "$$ARCH"; \
	SWE_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("sweastrology" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	SWE_ARCHS=$$(lipo -archs "$$SWE_SO" 2>/dev/null || true); \
	case " $$SWE_ARCHS " in *" $$ARCH "*) ;; *) echo "$$SWE_SO has architecture(s) '$$SWE_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	KERNEL_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("aries/astrology/transit_fast/_transit_kernel" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	KERNEL_ARCHS=$$(lipo -archs "$$KERNEL_SO" 2>/dev/null || true); \
	case " $$KERNEL_ARCHS " in *" $$ARCH "*) ;; *) echo "$$KERNEL_SO has architecture(s) '$$KERNEL_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	$(WEB_PYTHON) -c 'from aries.astrology.transit_fast import api; assert api.native_backend_available(), "native transit kernel import failed"'
	$(WEB_PYTHON) -m PyInstaller webapp/daemon/aries-daemon.spec --clean --noconfirm --workpath webapp/.pyinstaller-build --distpath webapp/.pyinstaller-dist
	@ARCH=$$($(WEB_PYTHON) -c 'import platform; print(platform.machine())'); \
	if [ "$$ARCH" = "arm64" ]; then TRIPLE=aarch64-apple-darwin; else TRIPLE=x86_64-apple-darwin; fi; \
	mkdir -p webapp/frontend/src-tauri/binaries; \
	mkdir -p webapp/frontend/src-tauri/binaries/aries-daemon; \
	find webapp/frontend/src-tauri/binaries/aries-daemon -mindepth 1 ! -name .gitkeep -exec rm -rf {} +; \
	rm -f webapp/frontend/src-tauri/binaries/aries-daemon-aarch64-apple-darwin webapp/frontend/src-tauri/binaries/aries-daemon-x86_64-apple-darwin; \
	cp -R webapp/.pyinstaller-dist/aries-daemon/. webapp/frontend/src-tauri/binaries/aries-daemon/; \
	SWE_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("sweastrology" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	DAEMON_ARCHS=$$(lipo -archs webapp/frontend/src-tauri/binaries/aries-daemon/_internal/$$SWE_SO 2>/dev/null || true); \
	case " $$DAEMON_ARCHS " in *" $$ARCH "*) ;; *) echo "Bundled $$SWE_SO has architecture(s) '$$DAEMON_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac; \
	KERNEL_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("_transit_kernel" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	KERNEL_PATH=webapp/frontend/src-tauri/binaries/aries-daemon/_internal/aries/astrology/transit_fast/$$KERNEL_SO; \
	KERNEL_ARCHS=$$(lipo -archs "$$KERNEL_PATH" 2>/dev/null || true); \
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

package: web-notes web-corpus web-daemon-binary web-legal
	cd webapp/frontend && ARIES_LICENSE_REQUIRED=0 npx tauri build

web: package

clean:
	rm -rf build dist __pycache__

# These fragments exist only in the private workspace. The public Makefile is
# complete without them and never needs release credentials.
-include ops/owner-development.mk
-include ops/owner-release.mk

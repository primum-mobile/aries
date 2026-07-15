.DEFAULT_GOAL := help

.PHONY: help run check package build-ext clean web web-tauri web-tauri-status
.PHONY: web-tauri-stop web-tauri-reset web-live-smoke web-daemon web-dev
.PHONY: web-frontend web-hosted-build web-notes web-corpus web-runtime-resources web-legal web-venv web-build-deps
.PHONY: web-daemon-binary web-verify-parity style-check style-token-check

# POSIX-oriented helper targets.
# On native Windows shells, prefer direct `python` / PowerShell commands.

PYTHON ?= python3
SWEP_SRC ?= SWEP/src
WEB_DAEMON_PORT ?= 8765
WEB_PYTHON ?= webapp/.venv/bin/python
ARCH ?= arm64
ARIES_VERSION ?= 1.0.0b1
ARIES_PACK_SEED_SOURCES ?=
export ARIES_VERSION

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

run: web-venv web-notes web-corpus
	@if [ ! -x webapp/frontend/src-tauri/binaries/aries-daemon/aries-daemon ]; then \
		$(MAKE) web-daemon-binary; \
	fi
	$(MAKE) web-tauri

check: build-ext web-corpus web-runtime-resources web-legal
	cd webapp/frontend && npm run lint
	cd webapp/frontend && npm run typecheck
	cd webapp/frontend && npm test
	cd webapp/frontend/src-tauri && cargo test
	@if find tests aries -type f -name 'test_*.py' -print -quit 2>/dev/null | grep -q .; then \
		PYTHONPATH=$(SWEP_SRC) $(PYTHON) -m pytest -q; \
	else \
		printf '%s\n' 'No Python tests in this source export; running static checks only.'; \
	fi
	$(PYTHON) -m compileall -q *.py aries engine parsers webapp/daemon \
		scripts/stage_corpus_resources.py scripts/stage_tauri_runtime_resources.py \
		scripts/stage_tauri_legal_artifacts.py

build-ext:
	cd $(SWEP_SRC) && $(PYTHON) setup.py build_ext --inplace

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
web-tauri: web-venv web-notes web-corpus
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

web-daemon-binary: web-build-deps
	@ARCH=$$($(WEB_PYTHON) -c 'import platform; print(platform.machine())'); \
	case "$$ARCH" in arm64|x86_64) ;; *) echo "Unsupported daemon Python arch: $$ARCH" >&2; exit 1 ;; esac; \
	PYTHON_BIN="$(WEB_PYTHON)" ./scripts/build_sweastrology.sh "$$ARCH"; \
	SWE_SO=$$($(WEB_PYTHON) -c 'import sysconfig; print("sweastrology" + sysconfig.get_config_var("EXT_SUFFIX"))'); \
	SWE_ARCHS=$$(lipo -archs "$$SWE_SO" 2>/dev/null || true); \
	case " $$SWE_ARCHS " in *" $$ARCH "*) ;; *) echo "$$SWE_SO has architecture(s) '$$SWE_ARCHS', expected $$ARCH" >&2; exit 1 ;; esac
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
	echo "Daemon bundle at webapp/frontend/src-tauri/binaries/aries-daemon ($$TRIPLE)"

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

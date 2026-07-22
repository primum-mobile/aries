from __future__ import annotations

import base64
import json
import logging
import os
import sys
import threading
from pathlib import Path, PurePosixPath
from typing import Any, Optional


def _daemon_base_dir() -> Path:
    override = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        mei = getattr(sys, "_MEIPASS", None)
        if mei:
            return Path(mei)
    return Path(__file__).resolve().parents[2]


REPO_ROOT = _daemon_base_dir()
RES_DIR = REPO_ROOT / "Res"
os.environ.setdefault("ARIES_DAEMON_BASE_DIR", str(REPO_ROOT))

import astrology
import build_info
import eclipsepath
import mtexts

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from pydantic import BaseModel, Field

FIND_TRANSITS_TECHNIQUES = ("transits",)

_transit_search_service = None
_tables_service = None
_style_font_store = None
_style_font_store_directory = None
_style_font_store_lock = threading.Lock()


class _LazyDaemonService:
    def __init__(self, loader):
        object.__setattr__(self, "_loader", loader)
        object.__setattr__(self, "_service", None)
        object.__setattr__(self, "_lock", threading.Lock())

    def _get(self):
        service = object.__getattribute__(self, "_service")
        if service is not None:
            return service
        with object.__getattribute__(self, "_lock"):
            service = object.__getattribute__(self, "_service")
            if service is None:
                service = object.__getattribute__(self, "_loader")()
                object.__setattr__(self, "_service", service)
            return service

    def __getattr__(self, name):
        return getattr(self._get(), name)

    def __setattr__(self, name, value):
        if name.startswith("_"):
            object.__setattr__(self, name, value)
            return
        setattr(self._get(), name, value)

    def __delattr__(self, name):
        if name.startswith("_"):
            object.__delattr__(self, name)
            return
        delattr(self._get(), name)


def _load_about_service():
    from .about_service import about_service as service

    return service


def _load_ascensional_service():
    from .ascensional_service import ascensional_service as service

    return service


def _load_astrocart_service():
    from .astrocart_service import astrocart_service as service

    return service


def _load_astrolog_sphere_service():
    from .astrolog_sphere_service import astrolog_sphere_service as service

    return service


def _load_astrolabe_service():
    from .astrolabe_service import astrolabe_service as service

    return service


def _load_chart_picker_service():
    from .chart_picker_service import chart_picker_service as service

    return service


def _load_chart_snapshot_service():
    from .chart_service import chart_snapshot_service as service

    return service


def list_chart_names(source: Optional[str] = None):
    from .chart_service import list_chart_names as service

    return service(source)


def _load_circumambulation_service():
    from .directions_service import circumambulation_service as service

    return service


def _load_corpus_packs_service():
    from .corpus_packs_service import corpus_packs_service as service

    return service


def _load_directions_service():
    from .directions_service import directions_service as service

    return service


def _load_editor_service():
    from .editor_service import editor_service as service

    return service


def _load_ephemeris_service():
    from .ephemeris_service import ephemeris_service as service

    return service


def _load_inspector_service():
    from .inspector_service import inspector_service as service

    return service


def _load_inspector_zone_b_service():
    from .inspector_zone_b_service import inspector_zone_b_service as service

    return service


def _load_io_service():
    from .io_service import io_service as service

    return service


def _load_manifest_service():
    from .manifest_service import manifest_service as service

    return service


def _load_mundane_chart_service():
    from .mundane_chart_service import mundane_chart_service as service

    return service


def _load_notes_service():
    import webapp.daemon.notes_service as service

    return service


def read_note_state(*args, **kwargs):
    return notes_service.read_note_state(*args, **kwargs)


def write_note_state(*args, **kwargs):
    return notes_service.write_note_state(*args, **kwargs)


def commit_scratch_note(*args, **kwargs):
    return notes_service.commit_scratch_note(*args, **kwargs)


def discard_scratch_note(*args, **kwargs):
    return notes_service.discard_scratch_note(*args, **kwargs)


def _load_options_service():
    from .options_service import options_service as service

    return service


def _load_secondary_directions_service():
    from .directions_service import secondary_directions_service as service

    return service


def _load_square_chart_service():
    from .square_chart_service import square_chart_service as service

    return service


def _load_supplementary_service():
    from .supplementary_service import supplementary_service as service

    return service


def _load_synodic_service():
    from .synodic_service import synodic_service as service

    return service


def _load_style_draft_service():
    from .style_draft_service import style_draft_service as service

    return service


def _supplementary_kinds() -> set[str]:
    from .supplementary_service import SUPPLEMENTARY_KINDS

    return set(SUPPLEMENTARY_KINDS)


def _load_table_export_service():
    from .table_export_service import table_export_service as service

    return service


def _load_workspace_service():
    from .workspace_service import workspace_service as service

    return service


def _load_spotlight_service():
    from .spotlight_service import spotlight_service as service

    return service


about_service = _LazyDaemonService(_load_about_service)
ascensional_service = _LazyDaemonService(_load_ascensional_service)
astrocart_service = _LazyDaemonService(_load_astrocart_service)
astrolog_sphere_service = _LazyDaemonService(_load_astrolog_sphere_service)
astrolabe_service = _LazyDaemonService(_load_astrolabe_service)
chart_picker_service = _LazyDaemonService(_load_chart_picker_service)
chart_snapshot_service = _LazyDaemonService(_load_chart_snapshot_service)
circumambulation_service = _LazyDaemonService(_load_circumambulation_service)
corpus_packs_service = _LazyDaemonService(_load_corpus_packs_service)
directions_service = _LazyDaemonService(_load_directions_service)
editor_service = _LazyDaemonService(_load_editor_service)
ephemeris_service = _LazyDaemonService(_load_ephemeris_service)
inspector_service = _LazyDaemonService(_load_inspector_service)
inspector_zone_b_service = _LazyDaemonService(_load_inspector_zone_b_service)
io_service = _LazyDaemonService(_load_io_service)
manifest_service = _LazyDaemonService(_load_manifest_service)
mundane_chart_service = _LazyDaemonService(_load_mundane_chart_service)
notes_service = _LazyDaemonService(_load_notes_service)
options_service = _LazyDaemonService(_load_options_service)
secondary_directions_service = _LazyDaemonService(_load_secondary_directions_service)
square_chart_service = _LazyDaemonService(_load_square_chart_service)
supplementary_service = _LazyDaemonService(_load_supplementary_service)
synodic_service = _LazyDaemonService(_load_synodic_service)
style_draft_service = _LazyDaemonService(_load_style_draft_service)
table_export_service = _LazyDaemonService(_load_table_export_service)
workspace_service = _LazyDaemonService(_load_workspace_service)
spotlight_service = _LazyDaemonService(_load_spotlight_service)


def transit_search_service():
    global _transit_search_service
    if _transit_search_service is None:
        from .search_service import transit_search_service as service

        _transit_search_service = service
    return _transit_search_service


def _transit_search_service_instance():
    service = transit_search_service
    return service() if callable(service) else service


def tables_service():
    global _tables_service
    if _tables_service is None:
        from .tables_service import tables_service as service

        _tables_service = service
    return _tables_service


def style_font_store():
    """Return the font store for the current daemon options directory."""
    global _style_font_store, _style_font_store_directory
    from .style_font_service import StyleFontError, StyleFontStore

    options_directory = str(getattr(options_service.options, "optsdirtxt", "") or "").strip()
    if not options_directory:
        raise StyleFontError("options directory is unavailable")
    if _style_font_store is not None and _style_font_store_directory == options_directory:
        return _style_font_store
    with _style_font_store_lock:
        if _style_font_store is None or _style_font_store_directory != options_directory:
            _style_font_store = StyleFontStore(options_directory, REPO_ROOT)
            _style_font_store_directory = options_directory
        return _style_font_store


app = FastAPI(title="Aries Web Daemon")


_TAURI_CORS_ORIGINS = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]

_DEV_CORS_ORIGINS = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3010",
    "http://localhost:3010",
    *_TAURI_CORS_ORIGINS,
]


def _daemon_token() -> str:
    return os.environ.get("ARIES_DAEMON_TOKEN", "").strip()


def _cors_origins() -> list[str]:
    override = os.environ.get("ARIES_DAEMON_CORS_ORIGINS", "").strip()
    if override:
        return [origin.strip() for origin in override.split(",") if origin.strip()]
    if _daemon_token():
        return list(_TAURI_CORS_ORIGINS)
    return list(_DEV_CORS_ORIGINS)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    # Style profiles are daemon-owned CRUD data. Their DELETE endpoint is used
    # from the Tauri/WebView origin, so it must survive the browser preflight
    # just like the existing GET/POST options routes.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "If-Match", "X-Aries-Token"],
    expose_headers=["ETag"],
)


def _request_token(request: Request) -> str:
    return request.headers.get("X-Aries-Token", "").strip() or request.query_params.get("token", "").strip()


def _websocket_token(websocket: WebSocket) -> str:
    return websocket.headers.get("X-Aries-Token", "").strip() or websocket.query_params.get("token", "").strip()


@app.middleware("http")
async def require_daemon_token(request: Request, call_next):
    token = _daemon_token()
    if request.url.path.startswith("/api/style-lab/") and not token:
        return PlainTextResponse("not found", status_code=404)
    if not token or request.method == "OPTIONS" or not request.url.path.startswith("/api/"):
        return await call_next(request)
    if _request_token(request) != token:
        return PlainTextResponse("unauthorized", status_code=401)
    return await call_next(request)


_RES_ROOT_ALLOWLIST = {
    "Morinus.ttf",
}

_RES_ASTROCART_ALLOWLIST = {
    "astrocart/map.html",
    "astrocart/capitals.geojson",
    "astrocart/places.geojson",
    "astrocart/vendor/maplibre-gl.css",
    "astrocart/vendor/maplibre-gl.js",
    "astrocart/vendor/pmtiles.js",
}

_RES_NOTES_ALLOWLIST = {
    "notes/index.html",
    "notes/assets/editor.css",
    "notes/assets/editor.js",
}

def _allowed_res_resource(resource_path: str) -> Optional[Path]:
    """Serve only the daemon-hosted assets the web shell actually loads.

    The old StaticFiles mount exposed the whole bundled Res tree, including
    factory option files and database artifacts. Astrocart and the notes editor
    need only small static surfaces, so keep that public surface explicit.
    """
    rel = PurePosixPath(resource_path)
    if rel.is_absolute() or any(part in {"", ".", ".."} for part in rel.parts):
        return None
    if any(part.startswith(".") for part in rel.parts):
        return None
    normalized = rel.as_posix()
    if normalized in _RES_ROOT_ALLOWLIST:
        pass
    elif normalized in _RES_ASTROCART_ALLOWLIST:
        pass
    elif normalized in _RES_NOTES_ALLOWLIST:
        pass
    else:
        return None

    path = (RES_DIR / Path(*rel.parts)).resolve()
    try:
        path.relative_to(RES_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


@app.get("/Res/{resource_path:path}")
def res_resource(resource_path: str):
    path = _allowed_res_resource(resource_path)
    if path is None:
        raise HTTPException(status_code=404, detail="resource not found")
    return FileResponse(path)


@app.get("/astrocart/basemap.pmtiles")
def astrocart_local_basemap():
    """Stable same-daemon range URL for the installed offline world map.

    The previous metadata URL pointed at a second random loopback port.  That
    port died whenever Tauri restarted its daemon while the frontend kept the
    cached URL.  FileResponse provides byte ranges on the canonical daemon
    origin, so PMTiles remains valid for the whole daemon generation.
    """
    import astrocart_tiles

    path = astrocart_tiles.default_local_pmtiles()
    if not path or not Path(path).is_file():
        raise HTTPException(status_code=404, detail="offline basemap unavailable")
    return FileResponse(
        path,
        media_type="application/vnd.pmtiles",
        headers={"Cache-Control": "private, max-age=3600"},
    )


def _custom_significator_from_query(value: Optional[str]) -> Optional[dict[str, Any]]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid customSignificator") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="invalid customSignificator")
    return parsed


def _options_preview_from_query(value: Optional[str]) -> Optional[dict[str, Any]]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid optionsPreview") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="invalid optionsPreview")
    return parsed


def _raise_inspector_lookup_error(exc: ValueError) -> None:
    """Map live-session lookup misses to the inspector's empty-payload contract."""
    message = str(exc)
    raise HTTPException(status_code=404, detail=message) from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/app/splash")
def app_splash() -> dict:
    """Return the startup splash text from the same source as wx MFrame.drawSplash."""
    release_version = (getattr(build_info, "RELEASE_VERSION", "") or "").strip() or "dev"
    beta_build_id = (getattr(build_info, "BETA_BUILD_ID", "") or "").strip()
    subtitle = f"Aries {release_version} (build {beta_build_id})" if beta_build_id else f"Aries {release_version}"
    description = mtexts.txts["Description"] + str(astrology.swe_version())
    return {
        "title": "ARIES",
        "subtitle": subtitle,
        "infoLines": [mtexts.txts["FreeSoft"]] + [line.strip() for line in description.split("\n")],
        "supportUrl": "https://buymeacoffee.com/primum.mobile",
        "supportText": "Support the Development of Aries",
    }


@app.get("/api/charts")
def chart_list(source: Optional[str] = None) -> dict:
    """List chart entries available in the Hors source jsonl."""
    try:
        return {"charts": list_chart_names(source)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ChartPickerRenamePayload(BaseModel):
    source: str
    recordIndex: int
    name: str


class ChartPickerDeletePayload(BaseModel):
    rows: list[dict]


class ChartPickerSearchPayload(BaseModel):
    stationWindowDays: float | None = None
    placements: list[dict] = []
    aspects: list[dict] = []


class SpotlightPreviewPayload(BaseModel):
    text: str = ""


class SpotlightExecutePayload(BaseModel):
    text: str = ""
    action: str = "default"


class WorkspaceOpenTablePayload(BaseModel):
    parentRadixId: str
    tableId: str
    binding: dict | None = None


class WorkspaceOpenAscensionalTransitsPayload(BaseModel):
    parentRadixId: str
    sourceDocumentId: Optional[str] = None


class WorkspaceAscensionalEventPlacePayload(BaseModel):
    documentId: str
    place: dict


class WorkspaceAscensionalEventPlaceFromMapPayload(BaseModel):
    documentId: str
    lon: float
    lat: float
    placeName: str = ""


class WorkspaceRectifyRadixTimePayload(BaseModel):
    docId: str
    deltaSeconds: int


class WorkspaceTableBindingPayload(BaseModel):
    documentId: str
    binding: dict | None = None
    # Optional: a chart-owning document hosting a right-pane table (ZR pane)
    # names the table it is binding; plain table documents omit it.
    tableId: Optional[str] = None


class IoUploadedFile(BaseModel):
    name: str
    dataBase64: str
    relativePath: str | None = None


class IoImportPayload(BaseModel):
    kind: str
    paths: list[str] = Field(default_factory=list)
    files: list[IoUploadedFile] = Field(default_factory=list)
    text: Optional[str] = None
    collection: Optional[str] = None


class IoExportPayload(BaseModel):
    kind: str = "auto"
    path: str
    documentId: str | None = None


class IoExportBytesPayload(BaseModel):
    kind: str = "pdf"
    filename: str | None = None
    documentId: str | None = None


class IoRenderedExportPayload(BaseModel):
    kind: str
    pngBase64: str
    width: int
    height: int
    title: str | None = None
    documentId: str | None = None
    path: str


class IoRenderedExportBytesPayload(BaseModel):
    kind: str
    pngBase64: str
    width: int
    height: int
    title: str | None = None
    documentId: str | None = None
    filename: str | None = None


class IoTextExportPayload(BaseModel):
    path: str
    text: str = ""
    extension: str = "txt"


class TableExportPayload(BaseModel):
    """Rendered table/list/pane PDF export (commonwnd SaveAsBitmap parity).

    The view forwards the structured GenericTablePayload it already holds —
    columns + rows of cell dicts — and a Tauri-resolved destination path. The
    daemon renders that exact payload to PDF via the wx-free Platypus helper.
    """

    path: str
    title: str = "Table"
    columns: list[dict[str, Any]]
    rows: list[list[Any]]
    headerLines: list[str] | None = None


class TableExportBytesPayload(BaseModel):
    title: str = "Table"
    columns: list[dict[str, Any]]
    rows: list[list[Any]]
    headerLines: list[str] | None = None
    filename: str | None = None


class RestoreOpenChartsPayload(BaseModel):
    enabled: bool


@app.get("/api/chart-picker/rows")
def chart_picker_rows() -> dict:
    """Rows for the system-chrome chart picker.

    Oracle: macfiledialog.HoroscopeChoiceDialog. Each row is a JSONL record
    addressed by collection path + record index; the frontend sorts/renders only.
    """
    try:
        return chart_picker_service.rows()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/spotlight/preview")
def spotlight_preview(payload: SpotlightPreviewPayload) -> dict:
    """Preview ambient spotlight text without mutating the workspace.

    This is the webapp twin of the wx spotlight parser/matcher path; execution
    remains a later route so typing never opens or changes a chart.
    """
    try:
        return spotlight_service.preview(payload.text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/spotlight/execute")
def spotlight_execute(payload: SpotlightExecutePayload) -> dict:
    """Execute a confirmed ambient spotlight action.

    Preview is deliberately separate so routine typing never mutates the
    workspace.
    """
    try:
        return spotlight_service.execute(payload.text, payload.action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/import")
def io_import(payload: IoImportPayload) -> dict:
    """File -> Import backend.

    Tauri/native dialogs supply selected path strings; browser shells supply
    selected file bytes; AAF paste supplies text. The daemon performs all
    HOR/JSONL/SFcht/AAF reads, duplicate checks, conversions, and collection
    writes through the existing Python helpers.
    """
    try:
        return io_service.import_charts(
            kind=payload.kind,
            paths=payload.paths,
            files=[file.model_dump() for file in payload.files],
            text=payload.text,
            collection=payload.collection,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class IoSavePayload(BaseModel):
    documentId: str
    path: Optional[str] = None
    # In-app "Save to Collection" picker: a collection NAME (new or existing) or
    # path; resolved to <charts dir>/<name>.jsonl via the editor's canonical
    # resolver. A .jsonl is a multi-chart collection. Explicit Save As writes a
    # new record id while preserving every other chart in the target collection.
    # Takes precedence over ``path`` when given.
    collection: Optional[str] = None
    # Chart name from the wx-style name prompt (renames the live chart + record
    # before writing). Omit to keep the current name.
    name: Optional[str] = None


@app.post("/api/io/save")
def io_save(payload: IoSavePayload) -> dict:
    """File > Save Horoscope / Save As (DEF-007 core).

    No ``collection``/``path``: upsert into the document's bound collection.
    With ``collection`` (in-app picker, name or path): resolve to a collection
    .jsonl in the charts dir, write a fresh record id, then REBIND the document
    to that copy. ``path`` is the legacy direct-path form. A .jsonl is a
    multi-chart collection; saving never overwrites the others. 400 when the
    document owns no Record."""
    target = payload.path
    if payload.collection:
        target = str(editor_service._resolve_collection_path(payload.collection))
    try:
        return workspace_service.save_document(
            payload.documentId, path=target, name=payload.name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/export")
def io_export(payload: IoExportPayload) -> dict:
    """File -> Export backend.

    Tauri/native dialogs only supply a destination path. The daemon resolves the
    active workspace chart and writes PNG/PDF through the source-backed Python
    export helper; React never receives file bytes.
    """
    try:
        return io_service.export_chart(
            kind=payload.kind,
            path=payload.path,
            document_id=payload.documentId,
            workspace=workspace_service,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/export-bytes")
def io_export_bytes(payload: IoExportBytesPayload) -> dict:
    """Browser File -> Export backend.

    Browser shells cannot provide a native destination path. The daemon still
    resolves the active workspace chart and renders through the same export
    helper, but writes to a temporary file and returns bytes for a Blob download.
    """
    try:
        result = io_service.export_chart_bytes(
            kind=payload.kind,
            filename=payload.filename,
            document_id=payload.documentId,
            workspace=workspace_service,
        )
        data = result.pop("data")
        result["dataBase64"] = base64.b64encode(data).decode("ascii")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/export-rendered")
def io_export_rendered(payload: IoRenderedExportPayload) -> dict:
    """Write the PNG/PDF painted by the visible production chart renderer."""
    try:
        return io_service.export_rendered_chart(
            kind=payload.kind,
            path=payload.path,
            png_base64=payload.pngBase64,
            width=payload.width,
            height=payload.height,
            title=payload.title,
            document_id=payload.documentId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/export-rendered-bytes")
def io_export_rendered_bytes(payload: IoRenderedExportBytesPayload) -> dict:
    try:
        result = io_service.export_rendered_chart_bytes(
            kind=payload.kind,
            png_base64=payload.pngBase64,
            width=payload.width,
            height=payload.height,
            title=payload.title,
            document_id=payload.documentId,
            filename=payload.filename,
        )
        data = result.pop("data")
        result["dataBase64"] = base64.b64encode(data).decode("ascii")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/export-text")
def io_export_text(payload: IoTextExportPayload) -> dict:
    try:
        return io_service.export_text_file(
            path=payload.path,
            text=payload.text,
            extension=payload.extension,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/table/export")
def table_export(payload: TableExportPayload) -> dict:
    """Rendered table/list/pane PDF export (commonwnd.py:163 SaveAsBitmap parity).

    The Tauri shell supplies a destination path; the daemon renders the
    view-supplied structured table payload to PDF via the wx-free Platypus
    helper. Reuses pdfexport.export_table_document, not a second exporter.
    """
    try:
        return table_export_service.export_table(
            path=payload.path,
            title=payload.title,
            columns=payload.columns,
            rows=payload.rows,
            header_lines=payload.headerLines,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/table/export-bytes")
def table_export_bytes(payload: TableExportBytesPayload) -> dict:
    """Browser rendered-table PDF export."""
    try:
        result = table_export_service.export_table_bytes(
            title=payload.title,
            columns=payload.columns,
            rows=payload.rows,
            header_lines=payload.headerLines,
            filename=payload.filename,
        )
        data = result.pop("data")
        result["dataBase64"] = base64.b64encode(data).decode("ascii")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/io/startup")
def io_startup_state() -> dict:
    try:
        return workspace_service.startup_restore_state()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/startup/set-current")
def io_startup_set_current() -> dict:
    try:
        result = workspace_service.set_startup_chart_to_active()
        if not result.get("ok", False) and result.get("requires"):
            raise HTTPException(status_code=409, detail=result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/startup/clear")
def io_startup_clear() -> dict:
    try:
        return workspace_service.clear_startup_chart()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/startup/load")
def io_startup_load() -> dict:
    try:
        return workspace_service._load_startup_chart_if_configured()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/restore-open")
def io_restore_open_set(payload: RestoreOpenChartsPayload) -> dict:
    try:
        return workspace_service.set_restore_open_charts_enabled(payload.enabled)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/io/restore-open/save")
def io_restore_open_save() -> dict:
    try:
        return workspace_service.save_restore_open_charts()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/io/recent-charts")
def io_recent_charts() -> dict:
    """File > Recent Charts MRU for the native menu (morin.py:15716-15738).

    Labels/order are daemon truth (options.recent_chart_refs, cap 24, menu
    shows 12 like wx morin.py:15734); the skin renders verbatim."""
    try:
        return workspace_service.recent_charts()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class RecentChartOpenPayload(BaseModel):
    id: str = ""
    path: str
    chartId: str = ""
    label: str = ""


@app.post("/api/io/recent-charts/open")
def io_recent_charts_open(payload: RecentChartOpenPayload) -> dict:
    """Reopen a recent entry through the canonical workspace open door
    (morin.py:15740-15778). Stale paths remove the entry and 400 with a
    toast-able detail (wx FileHistory removal, morin.py:15710-15714)."""
    try:
        return workspace_service.open_recent_chart(
            recent_id=payload.id,
            path=payload.path,
            chart_id=payload.chartId,
            label=payload.label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/chart-picker/search-catalog")
def chart_picker_search_catalog() -> dict:
    try:
        return chart_picker_service.search_catalog()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/chart-picker/search")
def chart_picker_search(payload: ChartPickerSearchPayload) -> dict:
    try:
        return chart_picker_service.search(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/chart-picker/rename")
def chart_picker_rename(payload: ChartPickerRenamePayload) -> dict:
    try:
        return chart_picker_service.rename(
            source=payload.source,
            record_index=payload.recordIndex,
            name=payload.name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/chart-picker/delete")
def chart_picker_delete(payload: ChartPickerDeletePayload) -> dict:
    try:
        return chart_picker_service.delete(payload.rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/chart")
def chart_snapshot(
    source: Optional[str] = None,
    name: str = "Morinus",
    record_index: Optional[int] = Query(default=None, alias="recordIndex"),
    comparison_name: Optional[str] = Query(default=None, alias="comparisonName"),
    comparison_record_index: Optional[int] = Query(default=None, alias="comparisonRecordIndex"),
    radix_name: Optional[str] = Query(default=None, alias="radixName"),
    radix_record_index: Optional[int] = Query(default=None, alias="radixRecordIndex"),
    anchor_name: Optional[str] = Query(default=None, alias="anchorName"),
    anchor_record_index: Optional[int] = Query(default=None, alias="anchorRecordIndex"),
    overlay_render_mode: str = Query(default="full", alias="overlayRenderMode"),
    preview_variant: Optional[str] = Query(default=None, alias="previewVariant"),
    preview_houses: Optional[bool] = Query(default=None, alias="previewHouses"),
    preview_positions: Optional[bool] = Query(default=None, alias="previewPositions"),
    preview_terms: Optional[bool] = Query(default=None, alias="previewTerms"),
    preview_decans: Optional[bool] = Query(default=None, alias="previewDecans"),
    preview_aspects: Optional[bool] = Query(default=None, alias="previewAspects"),
    preview_minor_aspects: Optional[bool] = Query(default=None, alias="previewMinorAspects"),
    preview_outer_ring: Optional[str] = Query(default=None, alias="previewOuterRing"),
    preview_fixed_stars: Optional[bool] = Query(default=None, alias="previewFixedStars"),
) -> dict:
    try:
        preview_values = {
            "variant": preview_variant,
            "houses": preview_houses,
            "positions": preview_positions,
            "terms": preview_terms,
            "decans": preview_decans,
            "aspects": preview_aspects,
            "minorAspects": preview_minor_aspects,
            "outerRing": preview_outer_ring,
            "fixedStars": preview_fixed_stars,
        }
        preview_options = {
            key: value for key, value in preview_values.items() if value is not None
        }
        return chart_snapshot_service.snapshot(
            source=source,
            name=name,
            record_index=record_index,
            comparison_name=comparison_name,
            comparison_record_index=comparison_record_index,
            radix_name=radix_name,
            radix_record_index=radix_record_index,
            anchor_name=anchor_name,
            anchor_record_index=anchor_record_index,
            overlay_render_mode=overlay_render_mode,
            preview_options=preview_options or None,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# Dead first-generation endpoints removed 2026-06-11 (Wave 1,
# doc/migration/chart-lifecycle-census.md §E; zero frontend call sites):
# GET /api/chart/here-now            -> POST /api/workspace/open-here-now
# POST /api/chart/supplementary/step -> POST /api/workspace/navigate-key
# GET /api/chart/synastry            -> workspace open + chart-picker window
# POST /api/ascensional/snap         -> snap logic inside navigate-key


@app.get("/api/chart/supplementary")
def chart_supplementary(
    kind: str,
    name: str = "Morinus",
    source: Optional[str] = None,
    when: Optional[str] = Query(default=None, description="ISO datetime; defaults to now"),
    planet_type: Optional[int] = Query(default=None, alias="planetType"),
    binding: Optional[str] = Query(default=None, description="JSON SupplementaryBinding payload"),
) -> dict:
    supplementary_kinds = _supplementary_kinds()
    if kind not in supplementary_kinds:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported supplementary kind: {kind!r}. Allowed: {sorted(supplementary_kinds)}",
        )
    try:
        binding_payload = json.loads(binding) if binding else None
        return supplementary_service.snapshot(
            source=source,
            source_name=name,
            kind=kind,
            when_iso=when,
            binding_payload=binding_payload,
            planet_type=planet_type,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/ascensional/snapshot")
def ascensional_snapshot(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    record_index: Optional[int] = Query(default=None, alias="recordIndex"),
    event_jd: Optional[float] = Query(default=None, alias="eventJd"),
    when: Optional[str] = Query(default=None, description="Local wall-clock ISO datetime; defaults to now when eventJd is omitted"),
    place: Optional[str] = Query(default=None, description="JSON place override payload"),
    filter_to_active_moment: bool = Query(default=True, alias="filterToActiveMoment"),
    apply_precession: bool = Query(default=True, alias="applyPrecession"),
    include_near_misses: bool = Query(default=True, alias="includeNearMisses"),
    near_miss_max_orb_arcmin: float = Query(default=90.0, alias="nearMissMaxOrbArcmin"),
) -> dict:
    try:
        place_payload = json.loads(place) if place else None
        return ascensional_service.snapshot(
            source=source,
            name=name,
            document_id=document_id,
            record_index=record_index,
            event_jd=event_jd,
            when_iso=when,
            place_payload=place_payload,
            filter_to_active_moment=filter_to_active_moment,
            apply_precession=apply_precession,
            include_near_misses=include_near_misses,
            near_miss_max_orb_arcmin=near_miss_max_orb_arcmin,
        )
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid place JSON: {exc}") from exc
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Primary Directions list + directions-to-solar-revolution — canonical PD engine
# (primdirs.PrimDirs) via engine.symbolic_projection. Bare /api/directions =
# the standard full PD list (RANGEALL + DIRECT). /api/directions/annual runs the
# same pipeline over a solar-revolution chart (calcTimeRev + annual narrowing).
# Spec: doc/migration/surfaces/primary-directions.md
# ---------------------------------------------------------------------------


class DirectionsSecondaryChartPayload(BaseModel):
    directionsDocumentId: str
    whenIso: str
    sessionLabel: Optional[str] = None


@app.get("/api/directions")
def directions_list(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    range_mode: int = Query(default=4, alias="range", description="0-25/25-50/50-75/75-100/All(4)/Rev(5)"),
    direction: int = Query(default=0, description="0=Direct, 1=Converse, 2=Both"),
    start_age: Optional[float] = Query(default=None, alias="startAge"),
    end_age: Optional[float] = Query(default=None, alias="endAge"),
    seek: str = Query(default="exact", description="exact/next/previous non-empty age window"),
    custom_significator_json: Optional[str] = Query(default=None, alias="customSignificator"),
    options_preview_json: Optional[str] = Query(default=None, alias="optionsPreview"),
) -> dict:
    """The full Primary Directions list for a radix (real dated-directions table).
    Bare call returns the standard list: full age range + direct directions."""
    try:
        return directions_service.primary_directions(
            source=source,
            name=name,
            document_id=document_id,
            range_mode=range_mode,
            direction=direction,
            start_age=start_age,
            end_age=end_age,
            seek=seek,
            custom_significator=_custom_significator_from_query(custom_significator_json),
            options_preview=_options_preview_from_query(options_preview_json),
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/directions/annual")
def directions_annual(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    year: Optional[int] = Query(default=None, description="Solar-revolution year; defaults to focus/birth year"),
    return_kind: str = Query(default="solar", alias="kind", description="solar or lunar return directions"),
    reference_datetime: Optional[str] = Query(default=None, alias="referenceDatetime"),
    range_mode: int = Query(default=5, alias="range", description="defaults to Revolution(5) = full SR year"),
    direction: int = Query(default=0, description="0=Direct, 1=Converse, 2=Both"),
    custom_significator_json: Optional[str] = Query(default=None, alias="customSignificator"),
    options_preview_json: Optional[str] = Query(default=None, alias="optionsPreview"),
) -> dict:
    """Directions to a solar/lunar revolution — the annual/monthly mode. Uses a
    live active return chart when supplied, otherwise builds the matching return
    around the focus date and runs the PD pipeline over that return chart."""
    try:
        return directions_service.annual_directions(
            source=source,
            name=name,
            document_id=document_id,
            year=year,
            return_kind=return_kind,
            reference_datetime=reference_datetime,
            range_mode=range_mode,
            direction=direction,
            custom_significator=_custom_significator_from_query(custom_significator_json),
            options_preview=_options_preview_from_query(options_preview_json),
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/directions/export-text")
def directions_export_text(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    mode: str = Query(default="radix", description="radix | revolution (annual/SR/LR PD list)"),
    range_mode: int = Query(default=4, alias="range"),
    direction: int = Query(default=0, description="0=Direct, 1=Converse, 2=Both"),
    start_age: Optional[float] = Query(default=None, alias="startAge"),
    end_age: Optional[float] = Query(default=None, alias="endAge"),
    year: Optional[int] = Query(default=None),
    return_kind: str = Query(default="solar", alias="kind"),
    reference_datetime: Optional[str] = Query(default=None, alias="referenceDatetime"),
    custom_significator_json: Optional[str] = Query(default=None, alias="customSignificator"),
) -> dict:
    """Save-As-Text export of the Primary Directions list and the PD-in-revolution
    list. The file body is the engine's PrimDirs.format2text (primdirslistwnd.
    onSaveAsText:1573 transcription) — never assembled in the skin."""
    try:
        return directions_service.primary_directions_text(
            source=source,
            name=name,
            document_id=document_id,
            mode=mode,
            range_mode=range_mode,
            direction=direction,
            start_age=start_age,
            end_age=end_age,
            year=year,
            return_kind=return_kind,
            reference_datetime=reference_datetime,
            custom_significator=_custom_significator_from_query(custom_significator_json),
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/directions/secondary")
def directions_secondary(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    start_age: Optional[float] = Query(default=None, alias="startAge"),
    end_age: Optional[float] = Query(default=None, alias="endAge"),
    method: str = Query(default="secondary", description="secondary|minor|tertiary"),
    direction: str = Query(default="direct", description="direct|converse|both"),
    reference_datetime: Optional[str] = Query(default=None, alias="referenceDatetime"),
) -> dict:
    """Secondary/minor/tertiary directions list (secdirframe.py popup). Row math
    is the wx-free engine.secondary_directions search."""
    try:
        return secondary_directions_service.secondary_directions(
            source=source,
            name=name,
            document_id=document_id,
            start_age=start_age,
            end_age=end_age,
            method=method,
            direction=direction,
            reference_datetime=reference_datetime,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/directions/secondary/export-text")
def directions_secondary_export_text(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    start_age: Optional[float] = Query(default=None, alias="startAge"),
    end_age: Optional[float] = Query(default=None, alias="endAge"),
    method: str = Query(default="secondary", description="secondary|minor|tertiary"),
    direction: str = Query(default="direct", description="direct|converse|both"),
    reference_datetime: Optional[str] = Query(default=None, alias="referenceDatetime"),
) -> dict:
    """Save-As-Text export of the secondary/minor/tertiary list — the same
    window of rows as /api/directions/secondary, formatted by the engine
    (secdirframe.onSaveAsText:1237 transcription)."""
    try:
        return secondary_directions_service.secondary_directions_text(
            source=source,
            name=name,
            document_id=document_id,
            start_age=start_age,
            end_age=end_age,
            method=method,
            direction=direction,
            reference_datetime=reference_datetime,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/directions/circumambulation")
def directions_circumambulation(
    name: str = "Morinus",
    source: Optional[str] = None,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    use_exact_oa: bool = Query(default=False, alias="useExactOa"),
    max_age: int = Query(default=150, alias="maxAge"),
    mode: str = Query(default="radix", description="radix|sr|lr"),
    year: Optional[int] = Query(default=None),
    return_kind: str = Query(default="solar", alias="kind"),
    reference_datetime: Optional[str] = Query(default=None, alias="referenceDatetime"),
    custom_significator_json: Optional[str] = Query(default=None, alias="customSignificator"),
) -> dict:
    """Circumambulations through the bounds (circumambulationframe.py popup)."""
    try:
        return circumambulation_service.circumambulations(
            source=source,
            name=name,
            document_id=document_id,
            use_exact_oa=use_exact_oa,
            max_age=max_age,
            mode=mode,
            year=year,
            return_kind=return_kind,
            reference_datetime=reference_datetime,
            custom_significator=_custom_significator_from_query(custom_significator_json),
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/directions/timed-chart")
def directions_timed_chart(body: dict = Body(...)) -> dict:
    """Open a real child chart for a direction-list event date (the Timed-chart
    context-menu actions: Solar Revolution / Transit / Chart)."""
    try:
        show_radix = bool(body.get("showRadix")) if "showRadix" in body else None
        return workspace_service.open_directions_timed_chart(
            directions_document_id=str(body.get("directionsDocumentId") or ""),
            action=str(body.get("action") or ""),
            when_iso=str(body.get("whenIso") or ""),
            event_jd=body.get("eventJd"),
            time_context=body.get("timeContext") if isinstance(body.get("timeContext"), dict) else None,
            session_label=body.get("sessionLabel") if isinstance(body.get("sessionLabel"), str) else None,
            show_radix=show_radix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/timed-chart-show-radix-default")
def options_timed_chart_show_radix_default() -> dict:
    """Default checked state for timed-list row context menus."""
    try:
        return options_service.get_timed_chart_show_radix_default()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/eclipses/chart-moment")
def eclipses_chart_moment(body: dict = Body(...)) -> dict:
    """Persist the Options/Eclipses chart-moment radio state."""
    try:
        return workspace_service.set_eclipse_chart_moment(str(body.get("mode") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/directions/pd-in-chart")
def directions_pd_in_chart(body: dict = Body(...)) -> dict:
    """Open a Primary-Directions row as a retained PD-in-Chart session.

    Source twin: PrimDirsListWnd._open_workspace_pd_tab
    (primdirslistwnd.py:1137-1185). The radix is advanced by the row's directed
    arc (engine.pd_in_chart.compute_pd_chart). Celestial uses the zodiacal
    COMPOUND wheel; terrestrial uses the legacy mundane-position comparison.
    """
    try:
        return workspace_service.open_directions_pd_in_chart(
            directions_document_id=str(body.get("directionsDocumentId") or ""),
            arc=float(body.get("arc") or 0.0),
            mode=str(body.get("mode") or ("terrestrial" if body.get("terrestrial") else "celestial")),
            direct=bool(body.get("direct", True)),
            event_jd=float(body["eventJd"]) if body.get("eventJd") is not None else None,
            when_iso=body.get("whenIso") if isinstance(body.get("whenIso"), str) else None,
            session_label=body.get("sessionLabel") if isinstance(body.get("sessionLabel"), str) else None,
            direction_event=body.get("directionEvent") if isinstance(body.get("directionEvent"), dict) else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/directions/secondary-chart")
def directions_secondary_chart(payload: DirectionsSecondaryChartPayload) -> dict:
    """Open/Step Secondary Chart from a secondary/minor/tertiary list row.

    secdirframe.py opens SECONDARY here even from Minor/Tertiary list variants;
    keep that source behavior and let the workspace service resolve the real
    radix parent from the view-only directions document.
    """
    try:
        return workspace_service.open_directions_secondary_chart(
            directions_document_id=payload.directionsDocumentId,
            when_iso=payload.whenIso,
            session_label=payload.sessionLabel,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/inspector")
def inspector_payload(
    kind: str = Query(..., description="region kind: planet|fortune|angle|house|sign|secondary_ring|aspect"),
    object_id: str = Query(..., alias="objectId", description="planet SE id, angle key, house/sign index, secondary_ring 'family|longitude|label', or aspect 'p1:p2:type'"),
    doc_id: Optional[str] = Query(default=None, alias="docId", description="live session document id — resolves the chart from session truth instead of name+source"),
    name: str = "Morinus",
    source: Optional[str] = None,
    here_now: bool = Query(default=False, alias="hereNow"),
    chart_role: str = Query(default="primary", alias="chartRole"),
    supplementary_kind: Optional[str] = Query(default=None, alias="supplementaryKind"),
    comparison_name: Optional[str] = Query(default=None, alias="comparisonName"),
    view_mode: Optional[int] = Query(default=None, alias="viewMode"),
    when: Optional[str] = Query(default=None, description="ISO datetime for supplementary; defaults to now"),
    binding: Optional[str] = Query(default=None, description="JSON SupplementaryBinding payload"),
) -> dict:
    """Faithful inspector payload — calls chartinspector.build_payload over a
    daemon-rebuilt chart. Mirrors what the wx hover pushes (state-contract B.1):
    the renderer's hover region → build_payload → inspector pane. The React
    pane renders this verbatim; it must NOT re-derive any field."""
    try:
        binding_payload = json.loads(binding) if binding else None
        payload = inspector_service.payload(
            kind=kind,
            object_id=object_id,
            doc_id=doc_id,
            source=source,
            name=name,
            here_now=here_now,
            chart_role=chart_role,
            supplementary_kind=supplementary_kind,
            comparison_name=comparison_name,
            when_iso=when,
            binding_payload=binding_payload,
            view_mode=view_mode,
        )
        if payload is None:
            raise HTTPException(status_code=404, detail="no payload for region")
        return payload
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        _raise_inspector_lookup_error(exc)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/inspector/flag")
def inspector_flag_payload(
    kind: str = Query(..., description="region kind: planet|fortune|angle|house|sign|secondary_ring|aspect"),
    object_id: str = Query(..., alias="objectId", description="same region object id as /api/inspector"),
    doc_id: Optional[str] = Query(default=None, alias="docId", description="live session document id — resolves the chart from session truth instead of name+source"),
    name: str = "Morinus",
    source: Optional[str] = None,
    here_now: bool = Query(default=False, alias="hereNow"),
    chart_role: str = Query(default="primary", alias="chartRole"),
    supplementary_kind: Optional[str] = Query(default=None, alias="supplementaryKind"),
    comparison_name: Optional[str] = Query(default=None, alias="comparisonName"),
    view_mode: Optional[int] = Query(default=None, alias="viewMode"),
    when: Optional[str] = Query(default=None, description="ISO datetime for supplementary; defaults to now"),
    binding: Optional[str] = Query(default=None, description="JSON SupplementaryBinding payload"),
) -> dict:
    """Compact on-chart hover-flag payload — chartinspector.build_flag_payload
    (chartinspector.py:1148), the second inspector entry point. The wx driver is
    workspace_shell._update_hover_flag (workspace_shell.py:5307): the renderer's
    hover region → build_flag_payload → the floating glyph card pinned to the
    symbol. The React canvas overlay renders this verbatim; it must NOT re-derive
    any field. Same region rebuild + error contract as /api/inspector."""
    try:
        binding_payload = json.loads(binding) if binding else None
        payload = inspector_service.flag_payload(
            kind=kind,
            object_id=object_id,
            doc_id=doc_id,
            source=source,
            name=name,
            here_now=here_now,
            chart_role=chart_role,
            supplementary_kind=supplementary_kind,
            comparison_name=comparison_name,
            when_iso=when,
            binding_payload=binding_payload,
            view_mode=view_mode,
        )
        if payload is None:
            raise HTTPException(status_code=404, detail="no flag payload for region")
        return payload
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        _raise_inspector_lookup_error(exc)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Inspector Zone B — source-text passages + pack alerts.
# Oracles: chartinspector/corpus_bridge (passages) + morin._refresh_pack_alerts
# (alerts). Spec: doc/migration/surfaces/inspector-zone-b.md
# ---------------------------------------------------------------------------


@app.get("/api/inspector/passages")
def inspector_passages(
    kind: str = Query(..., description="region kind: planet|fortune|angle|house|sign"),
    object_id: str = Query(..., alias="objectId", description="planet SE id, angle key, house/sign index"),
    doc_id: Optional[str] = Query(default=None, alias="docId", description="live session document id — resolves the chart from session truth instead of name+source"),
    name: str = "Morinus",
    source: Optional[str] = None,
    here_now: bool = Query(default=False, alias="hereNow"),
    supplementary_kind: Optional[str] = Query(default=None, alias="supplementaryKind"),
    comparison_name: Optional[str] = Query(default=None, alias="comparisonName"),
    view_mode: Optional[int] = Query(default=None, alias="viewMode"),
    when: Optional[str] = Query(default=None),
    binding: Optional[str] = Query(default=None, description="JSON SupplementaryBinding payload"),
    max_results: int = Query(default=4, alias="maxResults"),
) -> dict:
    """Fixed Valens planet/sign definition for the hovered region (Zone B).
    All text/citation passes through from CorpusDB verbatim — nothing
    fabricated. `maxResults` is accepted only for compatibility with older
    web clients."""
    try:
        binding_payload = json.loads(binding) if binding else None
        return inspector_zone_b_service.passages(
            kind=kind,
            object_id=object_id,
            doc_id=doc_id,
            source=source,
            name=name,
            here_now=here_now,
            supplementary_kind=supplementary_kind,
            comparison_name=comparison_name,
            when_iso=when,
            binding_payload=binding_payload,
            view_mode=view_mode,
            max_results=max_results,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        _raise_inspector_lookup_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/inspector/alerts")
def inspector_alerts(
    discipline: Optional[str] = Query(default=None, description="elections|horary"),
    theme: Optional[str] = Query(default=None, description="UI theme label, e.g. 'Traveling'"),
    context: Optional[str] = Query(default=None, description="JSON horary context (significator houses)"),
    doc_id: Optional[str] = Query(default=None, alias="docId", description="live session document id — resolves the chart from session truth instead of name+source"),
    name: str = "Morinus",
    source: Optional[str] = None,
    here_now: bool = Query(default=False, alias="hereNow"),
    supplementary_kind: Optional[str] = Query(default=None, alias="supplementaryKind"),
    view_mode: Optional[int] = Query(default=None, alias="viewMode"),
    when: Optional[str] = Query(default=None),
    binding: Optional[str] = Query(default=None, description="JSON SupplementaryBinding payload"),
) -> dict:
    """Pack alerts for the active lens (Zone B). Port of
    morin._refresh_pack_alerts: lens params in → discipline evaluate →
    Alert list out. Empty list is valid (lens yields no alerts)."""
    try:
        ctx = json.loads(context) if context else None
        binding_payload = json.loads(binding) if binding else None
        return inspector_zone_b_service.alerts(
            discipline=discipline,
            theme=theme,
            context=ctx,
            doc_id=doc_id,
            source=source,
            name=name,
            here_now=here_now,
            supplementary_kind=supplementary_kind,
            when_iso=when,
            binding_payload=binding_payload,
            view_mode=view_mode,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        _raise_inspector_lookup_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Corpus rule packs — list + active-pack toggle filter.
# Oracles: workspace_shell.py:2455/_populate_pack_toggles,
# workspace_shell.py:2558/_on_pack_toggled, morin.py:9005/_on_inspector_pack_change.
# Map: doc/migration/wiring/corpus-packs.md
# ---------------------------------------------------------------------------


class CorpusPackActivePayload(BaseModel):
    pack_id: str
    active: bool
    # Optional discipline scope for the returned list (wx scopes the toggle
    # strip to the selected discipline, workspace_shell.py:2472).
    discipline: Optional[str] = None


@app.get("/api/corpus/disciplines")
def corpus_disciplines() -> dict:
    """Discipline + theme catalog for the inspector lens picker — straight off
    rule_engine.registered_disciplines() / theme_labels_for()
    (workspace_shell.py:2441-2454 pickers). Horary themes include their
    default significator context (horary_rules.DEFAULT_SIGNIFICATORS,
    morin.py:9034) so the skin seeds lens context without computing it."""
    try:
        return corpus_packs_service.disciplines()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/corpus/packs")
def corpus_packs(discipline: Optional[str] = Query(default=None)) -> dict:
    """List corpus packs (manifest metadata verbatim) + the active filter.
    `active_pack_ids` null == all packs active (rule_engine.py:91-106)."""
    try:
        return corpus_packs_service.list_packs(discipline)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/corpus/packs/active")
def corpus_packs_set_active(payload: CorpusPackActivePayload) -> dict:
    """Flip one pack on/off (wx _on_pack_toggled semantics, persisted to the
    options dir like morin._on_inspector_pack_change)."""
    try:
        return corpus_packs_service.set_pack_active(
            payload.pack_id, payload.active, payload.discipline,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/corpus/packs/reload")
def corpus_packs_reload() -> dict:
    """Hot-reload packs from disk. Called by the aries-pack-author skill
    after dropping a new pack into the community pack root so the user
    doesn't have to restart Aries. Returns the new pack count so the agent
    can confirm pickup."""
    try:
        import rule_engine
        rule_engine.reload_packs()
        packs = rule_engine.list_packs()
        return {
            "ok": True,
            "pack_count": len(packs),
            "pack_ids": sorted(packs.keys()),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Chart editor (Personal Data) + JSONL collections — canonical chart
# construction / save via chartfile + geonames. Oracle: personaldatadlg.py.
# Spec: doc/migration/surfaces/chart-editor.md
# ---------------------------------------------------------------------------


class EditorBuildPayload(BaseModel):
    # The editor field set (personaldatadlg's apply() values). Accepts DMS +
    # E/W/N/S radios or signed decimal lat/lon; htype/cal/zt as wx enum index
    # or canonical string. See editor_service.editor_fields_to_record.
    fields: dict


class EditorSavePayload(BaseModel):
    collection: Optional[str] = None
    # Either a finished schema-v1 record or raw editor fields.
    record: dict


@app.get("/api/editor/meta")
def editor_meta() -> dict:
    """Enum catalogs (chart types / calendars / zone types) + canonical editor
    defaults (engine `now` + personaldatadlg.initialize() seeds). The skin renders
    the form from this and never hardcodes enum lists or seeds from the browser
    clock."""
    try:
        return editor_service.editor_meta()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/editor/load")
def editor_load(
    name: Optional[str] = Query(default=None, description="Chart name to load"),
    source: Optional[str] = Query(default=None, description="Collection .jsonl path"),
    record_id: Optional[str] = Query(default=None, alias="id"),
) -> dict:
    """Load an existing chart record (by id, else by name) from a .jsonl
    collection and return it in the editor's form-field shape PLUS the record
    `id` — so the editor prefills the form and a subsequent /api/editor/save
    overwrites by id rather than creating a duplicate."""
    try:
        return editor_service.load_chart_record(name, collection=source, record_id=record_id)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/editor/build")
def editor_build(payload: EditorBuildPayload) -> dict:
    """Construct a chart from editor fields on the canonical path and return its
    export snapshot for live preview (no save)."""
    try:
        return editor_service.build_chart(payload.fields)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/editor/resolve-place")
def editor_resolve_place(
    q: str = Query(..., description="City search query (>= 3 chars)"),
    max_rows: int = Query(default=10, alias="maxRows"),
) -> dict:
    """Geonames candidates for a typed city — the dialog's place search."""
    try:
        return {"candidates": editor_service.resolve_place(q, max_rows=max_rows)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/editor/save")
def editor_save(payload: EditorSavePayload) -> dict:
    """Upsert a chart record into a .jsonl collection (canonical chartfile
    writer, matched by id)."""
    try:
        return editor_service.save_chart(payload.collection, payload.record)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class EditorCursorApplyPayload(BaseModel):
    docId: str
    # The editor field set (same shape /api/editor/build accepts).
    fields: dict


@app.get("/api/editor/cursor-seed")
def editor_cursor_seed(
    doc_id: str = Query(..., alias="docId", description="Document to edit"),
) -> dict:
    """Seed the editor from a document's session CURSOR when ``onData`` would
    edit the stepping anchor instead of a stored radix (morin.py:14821). Returns
    `{usesSessionCursor: false}` for normal radixes — the skin then takes the
    stored-radix edit path. Otherwise returns the seed fields + `lockChartType`
    + `timeContextHint`."""
    try:
        return workspace_service.editor_cursor_seed(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/editor/radix-seed")
def editor_radix_seed(
    doc_id: str = Query(..., alias="docId", description="Open radix document to edit"),
) -> dict:
    """Seed the editor from the live open radix chart instead of the JSONL file.

    This keeps dirty in-memory edits (for example astrocart set_pob) visible in
    Cmd+E before they have been saved back to the collection.
    """
    try:
        return workspace_service.editor_radix_seed(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/editor/apply")
def editor_apply(payload: EditorCursorApplyPayload) -> dict:
    """Apply edited personal-data fields to an OPEN radix document IN PLACE
    (wx onData, morin.py:14869) — rebuild the radix from fields keeping the same
    Record id, swap into the live session (no reopen), auto-save to the bound
    collection + clear dirty (or mark dirty if unbound). 400 for derived/cursor
    docs (use /api/editor/apply-cursor)."""
    try:
        return workspace_service.apply_chart_edit(payload.docId, payload.fields)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/editor/apply-cursor")
def editor_apply_cursor(payload: EditorCursorApplyPayload) -> dict:
    """Apply edited fields back to a document's session-cursor chart — the
    daemon twin of _apply_data_dialog_to_session_cursor_chart (morin.py:14855).
    Re-derives the cursor chart via the canonical Binding -> Deriver -> Chart
    path and broadcasts session.changed + documents.changed."""
    try:
        return workspace_service.editor_apply_cursor(payload.docId, payload.fields)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/rectify-radix-time")
def workspace_rectify_radix_time(payload: WorkspaceRectifyRadixTimePayload) -> dict:
    """Nudge the owning radix time from a directions pane rectification strip.

    Direction/list docs are view-only children; the service resolves them to
    their parent radix before rebuilding and broadcasting.
    """
    try:
        return workspace_service.rectify_radix_time(payload.docId, payload.deltaSeconds)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/collections")
def collections_list() -> dict:
    """List the available .jsonl chart collections (default Hors source +
    siblings), each with an entry count."""
    try:
        return {"collections": editor_service.list_collections()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrocart")
def chart_astrocart(
    name: str = "Morinus",
    source: Optional[str] = None,
    mode: Optional[str] = None,
    precision: Optional[str] = None,
) -> dict:
    """ACG GeoJSON for a radix — planetary lines (MC/IC/ASC/DSC) and parans,
    with per-feature Morinus + Unicode glyph properties for map labels."""
    try:
        return astrocart_service.lines_geojson(
            source=source,
            source_name=name,
            mode=mode,
            precision=precision,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrocart/basemap")
def astrocart_basemap() -> dict:
    """Local PMTiles metadata for map.html.

    The frontend uses this only to pass the same optional ``tiles=`` fallback
    URL wx passes. map.html remains online-first unless launched with
    ``offline=1`` for debug/offline mode.
    """
    try:
        import astrocart_tiles

        path, installing = astrocart_tiles.default_install_state()
        return {
            "hasLocalTiles": bool(path),
            "tilesUrl": "/astrocart/basemap.pmtiles" if path else None,
            "installing": installing,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrocart/style")
def astrocart_display_style() -> dict:
    """Profile-aware map style for chartless/global Astrocart consumers."""
    try:
        return astrocart_service.display_style_for_default_location()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrocart/city-labels")
def astrocart_city_labels(
    west: float,
    south: float,
    east: float,
    north: float,
    zoom: float = 0.0,
    limit: Optional[int] = None,
) -> dict:
    """Viewport city labels from the bundled GeoNames cities500 database.

    Used by map.html for local/offline basemaps, where PMTiles provide land and
    borders but not reliable city names.
    """
    try:
        return astrocart_service.city_labels_geojson(
            west=west,
            south=south,
            east=east,
            north=north,
            zoom=zoom,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrocart/eclipse-path")
def astrocart_eclipse_path(jd: float, retflag: int = 0) -> dict:
    """Swiss Ephemeris solar-eclipse shadow-path GeoJSON for the astrocart map
    overlay. Wx twin: AstrocartPanel.set_eclipse_event (astrocartframe.py:326-342)
    calling eclipsepath.build_solar_eclipse_path_geojson; the React iframe pushes
    the result via the aries.setEclipseData postMessage bridge instead of
    RunScript."""
    try:
        return eclipsepath.build_solar_eclipse_path_geojson(float(jd), int(retflag) or None)
    except eclipsepath.EclipsePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/document/{doc_id}/astrocart")
def workspace_document_astrocart(
    doc_id: str,
    mode: Optional[str] = None,
    modes: Optional[str] = None,
    precision: Optional[str] = None,
) -> dict:
    """ACG GeoJSON for a workspace astrocart document, resolved from its live
    parent chart instead of a saved collection name."""
    try:
        return workspace_service.astrocart_geojson_for_document(
            doc_id,
            mode=mode,
            modes=None if modes is None else [part for part in modes.split(",") if part],
            precision=precision,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/document/{doc_id}/astrocart/style")
def workspace_document_astrocart_style(doc_id: str) -> dict:
    """Display-only ACG palette/glyph payload; never recalculates lines."""
    try:
        return workspace_service.astrocart_display_style_for_document(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/document/{doc_id}/astrocart/asterisms")
def workspace_document_astrocart_asterisms(doc_id: str) -> dict:
    """Date-correct asterism figures for the retained ACG overlay."""
    try:
        return workspace_service.astrocart_asterisms_geojson_for_document(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/document/{doc_id}/astrocart/view-state")
def workspace_document_astrocart_view_state(doc_id: str) -> dict:
    """Per-radix astrocart viewport state. Wx twin:
    AstrocartPanel.get_state/apply_state + MFrame.table_state_for_radix."""
    try:
        return workspace_service.astrocart_view_state_for_document(doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class WorkspaceAstrocartViewStatePayload(BaseModel):
    state: dict


@app.post("/api/workspace/document/{doc_id}/astrocart/view-state")
def workspace_document_astrocart_store_view_state(
    doc_id: str,
    payload: WorkspaceAstrocartViewStatePayload,
) -> dict:
    try:
        return workspace_service.store_astrocart_view_state_for_document(doc_id, payload.state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/ephemeris")
def graphic_ephemeris(year: int, startMonth: int = 1, includeStations: bool = True) -> dict:
    """Graphic Ephemeris curves for 12 anchored months: per-planet daily
    longitude + declination series (ephemcalc.EphemCalc as-is, ayanamsha
    rebased), month grid metadata, sign/planet glyph chars, colors, per-mode
    default visibility, longitude/declination station markers (SR/SD, DN/DS,
    EQ), and exact longitude sign-boundary events for optional marker glyphs.
    The skin only renders this payload."""
    try:
        return ephemeris_service.payload(year, startMonth, include_stations=includeStations)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/ephemeris/stations")
def graphic_ephemeris_stations(year: int, startMonth: int = 1) -> dict:
    """Deferred Graphic Ephemeris station markers. wx draws the curves first and
    builds snap targets after GraphEphemWnd.STATION_DEBOUNCE_MS; the webapp uses
    the same contract so keyboard stepping is not blocked by hover semantics."""
    try:
        return ephemeris_service.station_payload(year, startMonth)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class EphemerisStatePayload(BaseModel):
    state: dict


@app.get("/api/workspace/document/{doc_id}/ephemeris-state")
def workspace_ephemeris_state(doc_id: str) -> dict:
    """Per-radix Graphic Ephemeris view state (year/start_month/display_mode/
    visible_planets/show_grid/show_event_glyphs — morin.ephemeris_state_for_radix twin)."""
    try:
        return {"state": workspace_service.ephemeris_state_for_document(doc_id)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/document/{doc_id}/ephemeris-state")
def workspace_store_ephemeris_state(doc_id: str, payload: EphemerisStatePayload) -> dict:
    """morin.store_ephemeris_state_for_radix twin (morin.py:5421-5426)."""
    try:
        workspace_service.store_ephemeris_state_for_document(doc_id, payload.state)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrolabe")
def chart_astrolabe(
    name: str = "Morinus",
    source: Optional[str] = None,
    documentId: Optional[str] = None,
    delta: float = 0.0,
) -> dict:
    """Planispheric astrolabe geometry for a radix — the fixed tympan (horizon,
    equator, tropics, meridian, Regiomontanus houses, almucantars, azimuths,
    unequal-hour lines), the rotating rete (eccentric ecliptic + sign divisions
    + bright-star pointers) and the projected body positions, all in normalized
    R_eq=1 projection space. ``delta`` rotates the rete (primary-directions arc,
    degrees of RA). Projection: astrolabe_projection (the wx-free math the
    desktop AstrolabeChart draws with). ``delta`` is clamped non-negative: the
    rete is forward-only, mirroring wx max(0.0, ...) (morin.py:19367,19377)."""
    try:
        return astrolabe_service.geometry(
            source=source,
            source_name=name,
            document_id=documentId,
            delta_deg=max(0.0, float(delta)),
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/square-chart")
def chart_square(name: str = "Morinus", source: Optional[str] = None, documentId: Optional[str] = None) -> dict:
    """Square Chart (medieval square diagram) data for a radix: the 12 house
    cusps, the visible bodies grouped by house (with sign/deg/min, dignity
    colour and retrograde marker), and the header info lines. House membership
    and intra-house ordering are the engine's (houses.getHousePos + the wx
    ordering, squarechart.py:320-376). documentId resolves live workspace charts
    such as unsaved Here-and-Now children instead of falling back to the default
    source file."""
    try:
        return square_chart_service.data(source=source, source_name=name, document_id=documentId)
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/mundane-chart")
def chart_mundane(name: str = "Morinus", source: Optional[str] = None, documentId: Optional[str] = None) -> dict:
    """Mundane Chart data for a radix: every visible body at its MUNDANE
    position (the Placidian mundane longitude PMP, not the zodiacal longitude),
    the 12 equal mundane house spokes + names, and the ASC/IC/Desc/MC axes — all
    in mundane degrees (0 at the ASC). The mundane positions are the engine's
    speculum values (mundanechart.py:702-715). documentId resolves live
    workspace charts such as unsaved Here-and-Now children."""
    try:
        return mundane_chart_service.data(source=source, source_name=name, document_id=documentId)
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/astrolog-sphere")
def chart_astrolog_sphere(
    name: str = "Morinus",
    source: Optional[str] = None,
    documentId: Optional[str] = None,
    rotation: float = 7.0,
    tilt: float = -7.0,
) -> dict:
    """Astrolog-style chart sphere geometry for a radix.

    The daemon owns the math: current Aries chart positions, house cusps, active
    decan rulers, and active terms/bounds are projected into normalized sphere
    space. The React view only paints the returned lines and glyph anchors.
    """
    try:
        return astrolog_sphere_service.geometry(
            source=source,
            source_name=name,
            document_id=documentId,
            rotation=float(rotation),
            tilt=float(tilt),
        )
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class NotesPayload(BaseModel):
    radix: str
    content: str
    documentId: Optional[str] = None
    scratch: bool = False


class NotesScratchPayload(BaseModel):
    radix: str
    documentId: str


def _notes_record_context(radix: str, document_id: Optional[str], scratch: bool) -> tuple[str, Optional[str]]:
    if scratch or not document_id:
        return radix, None
    context = workspace_service.note_record_context(document_id)
    source_name = str(context.get("sourceName") or radix or "")
    record_id = str(context.get("recordId") or "").strip() or None
    return source_name, record_id


@app.get("/api/notes")
def notes_get(
    radix: str,
    document_id: Optional[str] = Query(default=None, alias="documentId"),
    scratch: bool = False,
) -> dict:
    source_name, record_id = _notes_record_context(radix, document_id, scratch)
    return read_note_state(
        source_name,
        record_id=record_id,
        document_id=document_id,
        scratch=scratch,
    )


@app.post("/api/notes")
def notes_set(payload: NotesPayload) -> dict:
    if not payload.radix:
        raise HTTPException(status_code=400, detail="radix required")
    try:
        source_name, record_id = _notes_record_context(
            payload.radix,
            payload.documentId,
            payload.scratch,
        )
        return write_note_state(
            source_name,
            payload.content,
            record_id=record_id,
            document_id=payload.documentId,
            scratch=payload.scratch,
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/notes/scratch/discard")
def notes_scratch_discard(payload: NotesScratchPayload) -> dict:
    if not payload.radix or not payload.documentId:
        raise HTTPException(status_code=400, detail="radix and documentId required")
    return discard_scratch_note(payload.radix, payload.documentId)


@app.post("/api/notes/scratch/commit")
def notes_scratch_commit(payload: NotesScratchPayload) -> dict:
    if not payload.radix or not payload.documentId:
        raise HTTPException(status_code=400, detail="radix and documentId required")
    source_name, record_id = _notes_record_context(
        payload.radix,
        payload.documentId,
        scratch=False,
    )
    return commit_scratch_note(source_name, payload.documentId, record_id=record_id)


# ---------------------------------------------------------------------------
# Options + appearance — canonical options.py exposed for read/patch.
# A change re-renders every open chart (headless _refresh_current_views,
# morin.py:3393) and broadcasts options.changed.
# Spec: doc/migration/surfaces/options.md
# ---------------------------------------------------------------------------


class OptionsPatchPayload(BaseModel):
    # Grouped partial patch, e.g. {"houseSystem": {"hsys": "R"}}.
    colors: Optional[dict] = None
    display: Optional[dict] = None
    houseSystem: Optional[dict] = None
    ayanamsha: Optional[dict] = None
    orbs: Optional[dict] = None
    dignities: Optional[dict] = None
    symbols: Optional[dict] = None
    lunarMansions: Optional[dict] = None
    speculum: Optional[dict] = None
    defaultLocation: Optional[dict] = None
    primaryDirections: Optional[dict] = None
    # Annual-profection flags (zodprof / usezodprojsprof / profwholesign):
    # the Profections pane Mode select + UseZodProjs check write through here
    # (options_service._apply_profections; wx profectionswnd.py:256-281).
    profections: Optional[dict] = None
    revolutions: Optional[dict] = None
    quickCharts: Optional[dict] = None
    stepAlerts: Optional[dict] = None
    # Per-feature Options-menu dialogs migrated as their own groups:
    #   almutens           -> _apply_almutens (almutenchartdlg scoring weights)
    #   firdaria           -> _apply_firdaria (firdariadlg nocturnal order)
    #   eclipses           -> _apply_eclipses (eclipse chart-moment radio)
    #   relationshipCharts -> _apply_relationship_charts (compositeoptsdlg + launcher)
    #   languages          -> _apply_languages (langsdlg; persistence only)
    # Pydantic silently DROPS fields not declared here (the profections-table
    # lesson) — keep in sync with set_options' group branches.
    almutens: Optional[dict] = None
    firdaria: Optional[dict] = None
    eclipses: Optional[dict] = None
    #   fixedStars -> _apply_fixed_stars (which-stars SE-catalog picker:
    #   selectedCodes set; options.fixstars key set + alias map + rebuildFixStars)
    fixedStars: Optional[dict] = None
    relationshipCharts: Optional[dict] = None
    languages: Optional[dict] = None
    # Planets/Points group (Nodes / Fortuna / Syzygy / Arabic Parts):
    # options_service._apply_planets_points. Pydantic silently DROPS fields not
    # declared here (the profections-table lesson) — keep in sync with
    # set_options' group branches.
    planetsPoints: Optional[dict] = None


class ArabicPartSpecPayload(BaseModel):
    # One lot-formula calculator state (options_service.preview_arabic_part /
    # _build_part_from_fields). refdeg slots are ints, name strings, or
    # embedded-formula lists (arabicpartsdlg.py parts_refdeg shapes).
    name: Optional[str] = None
    codes: list
    refdeg: Optional[list] = None
    diurnal: bool = False
    gendered: bool = False
    femaleCodes: Optional[list] = None
    femaleRefdeg: Optional[list] = None
    nocturnalCodes: Optional[list] = None
    nocturnalRefdeg: Optional[list] = None


class ArabicPartsImportPayload(BaseModel):
    parts: list


class ThemePresetPayload(BaseModel):
    name: str


class StyleProfileUpsertPayload(BaseModel):
    profile: dict[str, Any]
    activate: bool = False


class StyleProfileActivatePayload(BaseModel):
    profileId: str | None = None


class LegacyStyleMigrationPayload(BaseModel):
    values: dict[str, Any]
    activate: bool = True


class StyleDraftCreatePayload(BaseModel):
    draftId: str | None = None
    sourceProfileId: str | None = None
    profile: dict[str, Any] | None = None
    profileId: str | None = None
    name: str | None = None
    scope: str | None = None
    basePresetId: str | None = None


class StyleDraftPatchPayload(BaseModel):
    # Flat semantic-id delta. ``null`` removes an override and values are
    # normalized through the portable profile validator before publication.
    overrides: dict[str, Any] = Field(default_factory=dict)
    # Direct class-level profile-v2 values stay out of the legacy public token
    # catalog and use their own validated authoring channel.
    authoringOverrides: dict[str, Any] = Field(default_factory=dict)
    baseRevision: int | None = None


class StyleDraftValidatePayload(BaseModel):
    overrides: dict[str, Any] = Field(default_factory=dict)
    authoringOverrides: dict[str, Any] = Field(default_factory=dict)
    baseRevision: int | None = None


class StyleDraftCommitPayload(BaseModel):
    baseRevision: int | None = None
    activate: bool = False
    discard: bool = False


class StyleLabChartSourcesPayload(BaseModel):
    primaryId: str
    comparisonId: str | None = None


class StyleLabPreviewSnapshotPayload(BaseModel):
    chartSources: StyleLabChartSourcesPayload
    previewOptions: dict[str, Any] = Field(default_factory=dict)
    fixtureState: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/about")
def about_get() -> dict:
    """Aries-first About payload with release, license, and lineage metadata.

    Product identity and attribution stay daemon-owned; React localizes and
    renders the structured fields without treating historical credits as the
    product headline.
    """
    try:
        return about_service.get_about()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options")
def options_get() -> dict:
    """Current grouped options (colors / display / houseSystem / ayanamsha /
    orbs / dignities) + the available theme presets."""
    try:
        return options_service.get_options()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/theme-state")
def options_theme_state() -> dict:
    """Ready-to-apply shell/chart theme tokens plus version/hash metadata."""
    try:
        return options_service.get_theme_state()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/style-profiles")
def options_style_profiles() -> dict:
    """Named daemon-owned style profiles; localStorage is never authoritative."""
    try:
        return options_service.get_style_profiles()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/style-profiles/{profile_id}/export")
def options_style_profile_export(profile_id: str) -> dict:
    """Portable semantic-id profile payload suitable for a file export."""
    try:
        return options_service.get_style_profile_export(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/options/style-profiles")
def options_style_profile_save(payload: StyleProfileUpsertPayload) -> dict:
    """Validate and atomically create/update a named portable style profile."""
    try:
        result = options_service.save_style_profile(payload.profile, activate=payload.activate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if result.get("refreshMode"):
        workspace_service.broadcast_options_changed(
            result.get("refreshedDocumentIds"), result.get("refreshMode"), style_only=True
        )
    return result


@app.post("/api/options/style-profiles/import")
def options_style_profile_import(payload: StyleProfileUpsertPayload) -> dict:
    """Import uses the same strict validation and atomic write as profile save."""
    return options_style_profile_save(payload)


@app.post("/api/options/style-profiles/activate")
def options_style_profile_activate(payload: StyleProfileActivatePayload) -> dict:
    """Activate a profile, or pass null to reset to the daemon base theme."""
    try:
        result = options_service.activate_style_profile(payload.profileId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if result.get("refreshMode"):
        workspace_service.broadcast_options_changed(
            result.get("refreshedDocumentIds"), result.get("refreshMode"), style_only=True
        )
    return result


@app.delete("/api/options/style-profiles/{profile_id}")
def options_style_profile_delete(profile_id: str) -> dict:
    try:
        result = options_service.delete_style_profile(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if result.get("refreshMode"):
        workspace_service.broadcast_options_changed(
            result.get("refreshedDocumentIds"), result.get("refreshMode"), style_only=True
        )
    return result


@app.post("/api/options/style-profiles/migrate-legacy")
def options_style_profile_migrate_legacy(payload: LegacyStyleMigrationPayload) -> dict:
    """Idempotently convert the quarantined 53-token browser payload."""
    try:
        result = options_service.migrate_legacy_style_tokens(
            payload.values, activate=payload.activate
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if result.get("refreshMode"):
        workspace_service.broadcast_options_changed(
            result.get("refreshedDocumentIds"), result.get("refreshMode"), style_only=True
        )
    return result


# ---------------------------------------------------------------------------
# Chart Style Lab — ephemeral, revisioned profile authoring.
# Draft pointer moves never write options and never rebuild a ChartSession.
# The browser applies the published semantic delta to its retained canvas; an
# explicit commit is the only path into the persistent StyleProfileStore.
# ---------------------------------------------------------------------------


def _style_draft_expected(request: Request, base_revision: int | None) -> str | int:
    if_match = request.headers.get("If-Match", "").strip()
    if if_match:
        return if_match
    if base_revision is not None:
        return base_revision
    raise HTTPException(
        status_code=428,
        detail="style draft mutation requires If-Match or baseRevision",
    )


def _set_style_draft_etag(response: Response, payload: dict) -> None:
    etag = payload.get("etag")
    if isinstance(etag, str) and etag:
        response.headers["ETag"] = f'"{etag}"'
    response.headers["Cache-Control"] = "no-store"


def _raise_style_draft_error(exc: Exception) -> None:
    from .style_draft_service import StyleDraftConflictError, StyleDraftNotFoundError

    if isinstance(exc, StyleDraftConflictError):
        raise HTTPException(
            status_code=412,
            detail={
                "message": str(exc),
                "current": exc.current,
            },
        ) from exc
    if isinstance(exc, StyleDraftNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def _publish_style_draft(action: str, result: dict) -> None:
    draft = result.get("draft") if isinstance(result.get("draft"), dict) else None
    if draft is None and isinstance(result.get("overrides"), dict):
        draft = result
    try:
        workspace_service.manager.broadcast_threadsafe({
            "type": "style.draft.changed",
            "action": action,
            "draftId": result.get("draftId") or result.get("discardedDraftId"),
            "revision": result.get("revision"),
            "etag": result.get("etag"),
            "draft": draft,
            "changedTokenIds": list(result.get("changedTokenIds") or []),
            "removedTokenIds": list(result.get("removedTokenIds") or []),
            "changedAuthoringIds": list(result.get("changedAuthoringIds") or []),
            "removedAuthoringIds": list(result.get("removedAuthoringIds") or []),
            "refreshMode": "display-overlay",
            "styleOnly": True,
        })
    except Exception:
        # Publication is advisory. The checked mutation already succeeded and
        # must not be reported as failed merely because a browser disconnected.
        logging.getLogger(__name__).exception("style draft event publication failed")


async def _read_limited_request_body(request: Request, maximum: int) -> bytes:
    content_length = request.headers.get("content-length", "").strip()
    if content_length:
        try:
            if int(content_length) > maximum:
                raise HTTPException(status_code=413, detail="font upload is too large")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid Content-Length") from exc
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > maximum:
            raise HTTPException(status_code=413, detail="font upload is too large")
    return bytes(body)


def _style_lab_chart_source(source_id: str) -> dict[str, Any]:
    """Resolve one opaque picker row ID without consulting workspace state."""
    source_id = str(source_id or "").strip()
    if not source_id:
        raise HTTPException(status_code=400, detail="Style Lab chart source is required")
    payload = chart_picker_service.rows()
    rows = payload.get("rows", []) if isinstance(payload, dict) else []
    exact = [row for row in rows if isinstance(row, dict) and row.get("key") == source_id]
    if not exact:
        # chartId is accepted as a compatibility source ID only when it is
        # unambiguous across collections. New clients always send row.key.
        exact = [
            row for row in rows
            if isinstance(row, dict) and row.get("chartId") and row.get("chartId") == source_id
        ]
    if len(exact) != 1:
        raise HTTPException(status_code=404, detail="Style Lab chart source was not found")
    row = exact[0]
    return {
        "id": source_id,
        "source": str(row.get("source", "")),
        "recordIndex": int(row.get("recordIndex", -1)),
        "name": str(row.get("name", "")),
    }


@app.get("/api/style-lab/preview-schema")
def style_lab_preview_schema(response: Response) -> dict:
    try:
        result = chart_snapshot_service.style_lab_preview_manifest()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return result


@app.post("/api/style-lab/preview-snapshot")
def style_lab_preview_snapshot(
    payload: StyleLabPreviewSnapshotPayload,
    response: Response,
) -> dict:
    try:
        primary = _style_lab_chart_source(payload.chartSources.primaryId)
        comparison = (
            _style_lab_chart_source(payload.chartSources.comparisonId)
            if payload.chartSources.comparisonId
            else None
        )
        result = chart_snapshot_service.style_lab_snapshot(
            primary_source=primary,
            comparison_source=comparison,
            preview_options=payload.previewOptions,
            fixture_state=payload.fixtureState,
        )
    except HTTPException:
        raise
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return result


@app.get("/api/style-lab/catalog")
def style_lab_catalog(
    response: Response,
    q: str | None = None,
    scope: str | None = None,
    token_type: str | None = Query(default=None, alias="type"),
) -> dict:
    try:
        result = style_draft_service.catalog(query=q, scope=scope, token_type=token_type)
    except ValueError as exc:
        _raise_style_draft_error(exc)
    response.headers["Cache-Control"] = "no-store"
    return result


@app.get("/api/style-lab/authoring-schema")
def style_lab_authoring_schema(response: Response) -> dict:
    from .style_authoring_service import authoring_schema

    response.headers["Cache-Control"] = "no-store"
    return authoring_schema()


@app.get("/api/style-lab/catalog/{semantic_id}")
def style_lab_catalog_token(semantic_id: str, response: Response) -> dict:
    try:
        result = style_draft_service.catalog_token(semantic_id)
    except ValueError as exc:
        _raise_style_draft_error(exc)
    response.headers["Cache-Control"] = "no-store"
    return result


@app.get("/api/style-lab/fonts")
def style_lab_font_list(response: Response) -> dict:
    try:
        result = style_font_store().list_assets()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return result


@app.post("/api/style-lab/fonts", status_code=201)
async def style_lab_font_add(
    request: Request,
    response: Response,
    file_name: str = Query(alias="fileName", min_length=1, max_length=240),
    role: str = Query(default="text"),
    license_note: str = Query(default="", alias="licenseNote", max_length=1000),
) -> dict:
    from .style_font_service import MAX_FONT_BYTES

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/octet-stream":
        raise HTTPException(
            status_code=415,
            detail="font upload requires application/octet-stream",
        )
    try:
        result = style_font_store().add(
            await _read_limited_request_body(request, MAX_FONT_BYTES),
            original_name=file_name,
            role=role,
            license_note=license_note,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return result


@app.get("/api/style-lab/fonts/{asset_id}/file")
def style_lab_font_file(asset_id: str):
    try:
        store = style_font_store()
        asset = store.asset(asset_id)
        path = store.asset_path(asset_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type=str(asset.get("mediaType") or "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@app.get("/api/style-lab/drafts")
def style_lab_draft_list(response: Response) -> dict:
    result = style_draft_service.list_drafts()
    response.headers["Cache-Control"] = "no-store"
    return result


@app.post("/api/style-lab/drafts", status_code=201)
def style_lab_draft_create(payload: StyleDraftCreatePayload, response: Response) -> dict:
    try:
        if payload.profile is not None and payload.sourceProfileId is not None:
            raise ValueError("pass profile or sourceProfileId, not both")
        source_profile = payload.profile
        if payload.sourceProfileId is not None:
            if payload.sourceProfileId == "active":
                source_profile = options_service.get_active_style_profile()
                if source_profile is None:
                    raise HTTPException(status_code=404, detail="there is no active style profile")
            else:
                source_profile = options_service.get_style_profile_export(payload.sourceProfileId)
        resolved_base_preset_id = (
            payload.basePresetId
            if payload.basePresetId is not None
            else (source_profile or {}).get("basePresetId")
        )
        options_service.validate_style_profile_base({"basePresetId": resolved_base_preset_id})
        result = style_draft_service.create_draft(
            draft_id=payload.draftId,
            profile=source_profile,
            profile_id=payload.profileId,
            name=payload.name,
            scope=payload.scope,
            base_preset_id=payload.basePresetId,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        _raise_style_draft_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    _set_style_draft_etag(response, result)
    _publish_style_draft("created", result)
    return result


@app.get("/api/style-lab/drafts/{draft_id}")
def style_lab_draft_get(draft_id: str, response: Response) -> dict:
    try:
        result = style_draft_service.get_draft(draft_id)
    except ValueError as exc:
        _raise_style_draft_error(exc)
    _set_style_draft_etag(response, result)
    return result


@app.patch("/api/style-lab/drafts/{draft_id}")
def style_lab_draft_patch(
    draft_id: str,
    payload: StyleDraftPatchPayload,
    request: Request,
    response: Response,
) -> dict:
    expected = _style_draft_expected(request, payload.baseRevision)
    try:
        result = style_draft_service.patch_draft(
            draft_id,
            payload.overrides,
            authoring_overrides=payload.authoringOverrides,
            expected=expected,
        )
    except ValueError as exc:
        _raise_style_draft_error(exc)
    _set_style_draft_etag(response, result)
    if result.get("changed"):
        _publish_style_draft("patched", result)
    return result


@app.post("/api/style-lab/drafts/{draft_id}/validate")
def style_lab_draft_validate(
    draft_id: str,
    payload: StyleDraftValidatePayload,
    request: Request,
    response: Response,
) -> dict:
    expected = request.headers.get("If-Match", "").strip() or payload.baseRevision
    try:
        result = style_draft_service.validate_draft(
            draft_id,
            payload.overrides,
            authoring_overrides=payload.authoringOverrides,
            expected=expected,
        )
        options_service.validate_style_profile_base(result.get("profile"))
    except ValueError as exc:
        _raise_style_draft_error(exc)
    _set_style_draft_etag(response, result)
    return result


@app.post("/api/style-lab/drafts/{draft_id}/commit")
def style_lab_draft_commit(
    draft_id: str,
    payload: StyleDraftCommitPayload,
    request: Request,
    response: Response,
) -> dict:
    expected = _style_draft_expected(request, payload.baseRevision)
    try:
        if payload.activate:
            raise ValueError(
                "Style Lab commits never activate application styles; activate a saved profile separately"
            )
        result = style_draft_service.commit_draft(
            draft_id,
            expected=expected,
            persist=lambda profile: options_service.save_style_profile(
                profile,
                activate=False,
            ),
            discard=payload.discard,
        )
    except ValueError as exc:
        _raise_style_draft_error(exc)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    persistence = result.get("persistence") or {}
    if persistence.get("refreshMode"):
        workspace_service.broadcast_options_changed(
            persistence.get("refreshedDocumentIds"),
            persistence.get("refreshMode"),
            style_only=True,
        )
    _set_style_draft_etag(response, result)
    _publish_style_draft("committed", result)
    return result


@app.delete("/api/style-lab/drafts/{draft_id}")
def style_lab_draft_discard(
    draft_id: str,
    request: Request,
    response: Response,
    base_revision: int | None = Query(default=None, alias="baseRevision"),
) -> dict:
    expected = _style_draft_expected(request, base_revision)
    try:
        result = style_draft_service.discard_draft(draft_id, expected=expected)
    except ValueError as exc:
        _raise_style_draft_error(exc)
    response.headers["Cache-Control"] = "no-store"
    _publish_style_draft("discarded", result)
    return result


@app.get("/api/options/quickcharts-prompt-predicate")
def options_quickcharts_prompt_predicate() -> dict:
    """Saved quick-chart prompt predicate (morin._should_prompt_quickcharts,
    morin.py:11607). Gates the profections source-datetime prompt; React reads
    this and never infers it locally."""
    try:
        return options_service.get_quickcharts_prompt_predicate()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/progression-launch-predicate")
def options_progression_launch_predicate() -> dict:
    """Saved progression launcher mode.

    Mirrors morin._secondary_progression_launch_mode (morin.py:11620) for the
    Chart/Table/Both branch shared by list-capable progression launches.
    """
    try:
        return options_service.get_progression_launch_predicate()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/revolution-location-predicate")
def options_revolution_location_predicate(kind: str, planetType: Optional[int] = None) -> dict:
    """Saved Revolution location-mode predicate.

    The wx source prompts for Solar/Lunar/Planetary Return place only when the
    corresponding saved Revolution option is Ask (value 1). React uses this as
    the prompt gate and does not infer it locally.
    """
    try:
        return options_service.get_revolution_location_predicate(kind, planetType)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/options")
def options_set(payload: OptionsPatchPayload) -> dict:
    """Apply a partial grouped patch to the live canonical options object."""
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    try:
        result = options_service.set_options(patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if result.get("refreshMode"):
        workspace_service.broadcast_options_changed(
            result.get("refreshedDocumentIds"),
            result.get("refreshMode"),
            style_only=result.get("refreshMode") == "ui-style",
            list_data_changed=result.get("listDataChanged", True),
        )
    return result


@app.post("/api/options/arabic-parts/preview")
def options_arabic_parts_preview(payload: ArabicPartSpecPayload) -> dict:
    """Parse + format a candidate lot formula (the wx calculator's live
    Formula column, arabicpartsdlg.py:110-111). No options are written; the
    Python brain owns all formula semantics."""
    try:
        return options_service.preview_arabic_part(
            {k: v for k, v in payload.model_dump().items() if v is not None})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/options/arabic-parts/export")
def options_arabic_parts_export() -> PlainTextResponse:
    """JSON export of all user-defined Arabic Parts — byte-compatible with the
    wx OnExport file (arabicpartsdlg.py:2426-2469), serialized by Python so the
    bytes match json.dump(..., ensure_ascii=False, indent=2)."""
    try:
        text = options_service.export_arabic_parts_text()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return PlainTextResponse(text, media_type="application/json")


@app.post("/api/options/arabic-parts/import")
def options_arabic_parts_import(payload: ArabicPartsImportPayload) -> dict:
    """Append parts from a JSON export (wx OnImport semantics — duplicate/
    invalid items are skipped, name references resolved in a second pass,
    arabicpartsdlg.py:2478-2660), then refresh + broadcast like any options
    patch. Returns imported/skipped/unresolved counts."""
    try:
        result = options_service.import_arabic_parts(payload.parts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
    )
    return result


@app.post("/api/options/theme")
def options_theme(payload: ThemePresetPayload) -> dict:
    """Apply a colorsdlg palette preset, then re-render open charts and broadcast."""
    try:
        result = options_service.apply_theme_preset(payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
        list_data_changed=False,
    )
    return result


@app.post("/api/options/colors/defaults")
def options_colors_defaults() -> dict:
    """Restore colorsdlg's default color table, then re-render open charts."""
    try:
        result = options_service.reset_color_defaults()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
        list_data_changed=False,
    )
    return result


@app.post("/api/options/defaults")
def options_reset_all_defaults() -> dict:
    """Restore Default — reset EVERY option to its factory default and delete the
    persisted user pickles (headless analogue of morin.onReload, morin.py:21034),
    then re-render every open chart and broadcast options.changed."""
    try:
        result = options_service.reset_all_defaults()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
    )
    return result


@app.post("/api/options/cycle-secondary")
def options_cycle_secondary() -> dict:
    """Advance the radix secondary-view overlay one step (Ctrl+G — headless
    analogue of morin.onCycleNatalSecondaryRing, morin.py:1001), then re-render
    every open chart and broadcast options.changed."""
    try:
        result = options_service.cycle_radix_secondary()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
        list_data_changed=False,
    )
    return result


@app.post("/api/options/toggle-houses")
def options_toggle_houses() -> dict:
    """Flip the "Houses" appearance option (H — headless analogue of
    morin.onToggleHouses, morin.py:19535), then re-render every open chart and
    broadcast options.changed."""
    try:
        result = options_service.toggle_houses()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
        list_data_changed=False,
    )
    return result


@app.post("/api/options/toggle-aspects")
def options_toggle_aspects() -> dict:
    """Flip the Appearance Aspects master option, then re-render every open
    chart and broadcast options.changed."""
    try:
        result = options_service.toggle_aspects()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
        list_data_changed=False,
    )
    return result


@app.post("/api/options/toggle-minor-aspects")
def options_toggle_minor_aspects() -> dict:
    """Flip the Appearance minor aspect draw toggles as one group, then
    re-render every open chart and broadcast options.changed."""
    try:
        result = options_service.toggle_minor_aspects()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    workspace_service.broadcast_options_changed(
        result.get("refreshedDocumentIds"),
        result.get("refreshMode"),
        list_data_changed=False,
    )
    return result


# ---------------------------------------------------------------------------
# Workspace — the daemon owns ONE WorkspaceSessionController (slice 2).
# Commands apply to the in-memory controller and trigger a WS broadcast.
# Spec: doc/migration/surfaces/workspace-daemon.md
# ---------------------------------------------------------------------------


class WorkspaceOpenPayload(BaseModel):
    kind: str = "chart"
    sourceName: str = "Morinus"
    source: Optional[str] = None
    recordIndex: Optional[int] = None
    parentDocumentId: Optional[str] = None
    featureKind: Optional[str] = None
    comparisonName: Optional[str] = None
    when: Optional[str] = None
    # planetary-return only: which body's return to build (revolutions.py
    # PLANETARY_SPECS ids: MERCURY=2 VENUS=3 MARS=4 JUPITER=5 SATURN=6 URANUS=7
    # NEPTUNE=8 PLUTO=9, revolutions.py:91-98). Ignored otherwise.
    planetType: Optional[int] = None
    binding: Optional[dict] = None
    reuseExisting: bool = False


class SidebarSectionCollapsedPayload(BaseModel):
    sectionLabel: str
    collapsed: bool


class SidebarActionOrderPayload(BaseModel):
    sectionLabel: str
    actionId: str
    beforeId: Optional[str] = None


class WorkspaceActivatePayload(BaseModel):
    docId: str


class WorkspaceClosePayload(BaseModel):
    docId: str
    cascade: bool = True


class WorkspaceOpenSynastryPayload(BaseModel):
    parentRadixId: str
    comparisonName: str
    comparisonSource: Optional[str] = None
    comparisonRecordIndex: Optional[int] = None


class WorkspaceOpenAstrocartPayload(BaseModel):
    parentRadixId: str
    # Optional solar-eclipse path overlay request — the wx twin is
    # morin.show_eclipse_path_on_map (morin.py:16211-16227) passing the
    # eclipse event into AstrocartPanel.set_eclipse_event.
    eclipseJd: Optional[float] = None
    eclipseRetflag: Optional[int] = None


class WorkspaceOpenDirectionsPayload(BaseModel):
    parentRadixId: str
    customSignificator: Optional[dict[str, Any]] = None


class WorkspaceOpenTransitSearchPayload(BaseModel):
    parentDocumentId: str
    significatorId: Optional[str] = None
    chartRole: Optional[str] = None
    customPoints: list[dict] = Field(default_factory=list)


class WorkspaceOpenAstrolabePayload(BaseModel):
    parentRadixId: str


class WorkspaceOpenAstrologSpherePayload(BaseModel):
    parentRadixId: str


class WorkspaceOpenSquareChartPayload(BaseModel):
    parentRadixId: str


class WorkspaceOpenMundaneChartPayload(BaseModel):
    parentRadixId: str


class WorkspaceOpenEphemerisPayload(BaseModel):
    parentRadixId: str


class WorkspaceMovePayload(BaseModel):
    docId: str
    beforeId: Optional[str] = None  # None -> move to end of sibling group


class WorkspaceDragContextPayload(BaseModel):
    docId: str


class WorkspacePreviewMoveIntentPayload(BaseModel):
    sourceDocumentId: str
    targetDocumentId: Optional[str] = None
    beforeId: Optional[str] = None
    rootBeforeId: Optional[str] = None
    preferAttach: bool = False


class WorkspaceApplyMoveIntentPayload(BaseModel):
    sourceDocumentId: str
    moveIntent: Optional[dict] = None


class WorkspaceApplyDragConversionPayload(BaseModel):
    sourceDocumentId: str
    targetDocumentId: str
    action: str


class WorkspaceNavigatePayload(BaseModel):
    docId: str
    unit: str = "day"
    delta: int = 1


class WorkspaceNavigateKeyPayload(BaseModel):
    docId: str
    key: str  # 'left' | 'right' | 'up' | 'down' | 'space'
    shift: bool = False
    alt: bool = False
    repeat: int = Field(default=1, ge=1, le=64)


class WorkspaceToggleComparisonPayload(BaseModel):
    docId: str


class WorkspaceSynastryCompositePayload(BaseModel):
    docId: str
    variant: Optional[str] = None


class WorkspaceOpenHereNowPayload(BaseModel):
    when: Optional[str] = None


class WorkspaceContextMenuPayload(BaseModel):
    docId: Optional[str] = None
    region: Optional[dict] = None


class WorkspaceContextMenuActionPayload(BaseModel):
    actionId: str
    payload: Optional[dict] = None


class WorkspaceDocumentContextMenuPayload(BaseModel):
    docId: str


class SurveilCreateStudyPayload(BaseModel):
    name: str


class SurveilSetActiveStudyPayload(BaseModel):
    name: str


class SurveilMarkEnabledPayload(BaseModel):
    study: str
    markId: str
    enabled: bool


class SurveilRemoveMarkPayload(BaseModel):
    study: str
    markId: str


class SurveilClearStudyPayload(BaseModel):
    name: str


class SurveilOpenSourcePayload(BaseModel):
    sourceRef: Optional[dict] = None
    sourceName: Optional[str] = None


class TransitSearchPayload(BaseModel):
    documentId: str
    fromDate: str
    toDate: str
    techniques: list[str] = Field(default_factory=list)
    promittorIds: list[str] = Field(default_factory=list)
    significatorIds: list[str] = Field(default_factory=list)
    aspects: list[str] = Field(default_factory=list)
    includeSignChanges: bool = False
    partFilter: str = ""
    progressionMethod: Optional[int] = None
    objectMotionFilters: dict[str, str] = Field(default_factory=dict)
    limit: int = 500
    persistSettings: bool = True


class TransitSearchContextPayload(BaseModel):
    documentId: str
    significatorId: Optional[str] = None
    chartRole: Optional[str] = None
    customPoints: list[dict] = Field(default_factory=list)


class TransitSearchContextRunPayload(TransitSearchContextPayload):
    fromDate: str
    toDate: str
    techniques: list[str] = Field(default_factory=list)
    promittorIds: list[str] = Field(default_factory=list)
    significatorIds: list[str] = Field(default_factory=list)
    aspects: list[str] = Field(default_factory=list)
    includeSignChanges: bool = False
    partFilter: str = ""
    progressionMethod: Optional[int] = None
    objectMotionFilters: dict[str, str] = Field(default_factory=dict)
    limit: int = 500
    persistSettings: bool = True


class SearchDefaultRangePayload(BaseModel):
    offsetMonths: int
    rangeMonths: int


class SearchCancelPayload(BaseModel):
    sessionId: str


class SearchExportPayload(BaseModel):
    kind: str = "clipboard"
    rows: list[dict] = Field(default_factory=list)


@app.get("/api/workspace/manifest")
def workspace_manifest() -> dict:
    """The sidebar launcher catalog + keyboard-shortcut map, sourced from the
    canonical wx-free structures (workspace_model.DEFAULT_SECTIONS /
    DEFAULT_TOP_ACTIONS + shortcut_registry). The skin renders the sidebar and
    the shortcuts overlay from this — it owns neither catalog. Action ids are the
    exact dispatch ids the skin handles (new/open/now/synastry/astrocartography +
    supplementary public kinds); not-yet-built tabs are flagged enabled:false."""
    try:
        return manifest_service.manifest()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/sidebar-section-collapsed")
def workspace_sidebar_section_collapsed(payload: SidebarSectionCollapsedPayload) -> dict:
    """Persist one sidebar section's collapsed state through the daemon."""
    try:
        return manifest_service.set_section_collapsed(
            payload.sectionLabel,
            payload.collapsed,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/sidebar-action-order")
def workspace_sidebar_action_order(payload: SidebarActionOrderPayload) -> dict:
    """Persist launcher order within one sidebar section through the daemon."""
    try:
        return manifest_service.set_action_order(
            payload.sectionLabel,
            payload.actionId,
            payload.beforeId,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/state")
def workspace_state() -> dict:
    """Full current tree + active id + per-doc summary (initial client sync)."""
    try:
        return workspace_service.state()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _localize_menu(result: dict) -> dict:
    """Attach stable labelKeys to a daemon-built menu tree; the FRONTEND renders
    them from the shared catalog (chartmenu.*). This is the "daemon emits keys,
    frontend renders" path — translations live in one place (the frontend), not
    the daemon. Language-neutral; dynamic labels / proper nouns pass through."""
    try:
        from webapp.daemon import label_i18n
        label_i18n.attach_label_keys(result)
    except Exception:
        pass
    return result


@app.post("/api/workspace/context-menu")
def workspace_context_menu(payload: WorkspaceContextMenuPayload) -> dict:
    """Chart right-click context menu, built daemon-side from the active
    workspace/session/options state. React renders the returned tree verbatim."""
    try:
        return _localize_menu(workspace_service.chart_context_menu(payload.docId, region=payload.region))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/context-menu/action")
def workspace_context_menu_action(payload: WorkspaceContextMenuActionPayload) -> dict:
    """Execute a daemon-issued context-menu action id."""
    try:
        return workspace_service.run_context_menu_action(payload.actionId, payload.payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/document-context-menu")
def workspace_document_context_menu(payload: WorkspaceDocumentContextMenuPayload) -> dict:
    """Sidebar/tab document-row right-click menu, built daemon-side from the
    target document's workspace/session/options state. React renders the returned
    tree verbatim and dispatches returned action ids by document_id."""
    try:
        return _localize_menu(workspace_service.document_context_menu(payload.docId))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --- Surveil studies (the studies-dialog CRUD; surveil_service store) --------
# The marks themselves are mutated through the chart context-menu action route
# (surveil.toggle_mark / surveil.clear_study). These routes own the studies
# *management* surface (morin.py:1702-1834): list/create/activate studies,
# per-mark enable/remove, clear, and Open-Radix.


@app.get("/api/surveil/studies")
def surveil_studies() -> dict:
    try:
        return workspace_service.surveil_studies()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/surveil/marks")
def surveil_marks(study: Optional[str] = None) -> dict:
    try:
        return workspace_service.surveil_study_marks(study)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/surveil/studies/create")
def surveil_create_study(payload: SurveilCreateStudyPayload) -> dict:
    try:
        return workspace_service.surveil_create_study(payload.name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/surveil/studies/activate")
def surveil_set_active_study(payload: SurveilSetActiveStudyPayload) -> dict:
    try:
        return workspace_service.surveil_set_active_study(payload.name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/surveil/marks/enabled")
def surveil_set_mark_enabled(payload: SurveilMarkEnabledPayload) -> dict:
    try:
        return workspace_service.surveil_set_mark_enabled(payload.study, payload.markId, payload.enabled)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/surveil/marks/remove")
def surveil_remove_mark(payload: SurveilRemoveMarkPayload) -> dict:
    try:
        return workspace_service.surveil_remove_mark(payload.study, payload.markId)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/surveil/studies/clear")
def surveil_clear_study(payload: SurveilClearStudyPayload) -> dict:
    try:
        return workspace_service.surveil_clear_study(payload.name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/surveil/open-source")
def surveil_open_source(payload: SurveilOpenSourcePayload) -> dict:
    try:
        return workspace_service.surveil_open_source(payload.sourceRef, payload.sourceName or "")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/search/catalog")
def transit_search_catalog(documentId: str) -> dict:
    """Catalog/defaults for a transit-search workspace document.

    Oracle: searchwnd.SearchWnd builds SearchCatalog from the reference chart
    and uses saved/default search options to seed Transits search controls.
    """
    try:
        context = workspace_service.search_context(documentId)
        return _transit_search_service_instance().catalog(
            context["chart"],
            custom_points=context.get("custom_points"),
            initial_significator_id=context.get("initial_significator_id"),
            initial_techniques=(
                FIND_TRANSITS_TECHNIQUES
                if context.get("initial_significator_id")
                else None
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/transits")
def transit_search(payload: TransitSearchPayload) -> dict:
    """Run the existing Search backend for a search document."""
    try:
        context = workspace_service.search_context(payload.documentId)
        return _transit_search_service_instance().search(
            context["chart"],
            payload.model_dump(),
            custom_points=context.get("custom_points"),
            persist=bool(payload.persistSettings) and not bool(context.get("custom_points")),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/settings")
def transit_search_settings(payload: TransitSearchPayload) -> dict:
    """Persist Search controls for a search document without forcing a result run."""
    try:
        context = workspace_service.search_context(payload.documentId)
        return _transit_search_service_instance().save_settings(
            context["chart"],
            payload.model_dump(),
            custom_points=context.get("custom_points"),
            persist=bool(payload.persistSettings) and not bool(context.get("custom_points")),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/context/catalog")
def transit_search_context_catalog(payload: TransitSearchContextPayload) -> dict:
    """Catalog/defaults for the right-pane transit search.

    Unlike /api/search/catalog, this does not require or create a search
    workspace document. It resolves the reference chart from an existing chart
    document and keeps the active wheel visible.
    """
    try:
        context = workspace_service.search_context_for_document(
            payload.documentId,
            significator_id=payload.significatorId,
            chart_role=payload.chartRole,
            custom_points=payload.customPoints,
        )
        return _transit_search_service_instance().catalog(
            context["chart"],
            custom_points=context.get("custom_points"),
            initial_significator_id=context.get("initial_significator_id"),
            initial_techniques=(
                FIND_TRANSITS_TECHNIQUES
                if context.get("initial_significator_id")
                else None
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/context/transits")
def transit_search_context(payload: TransitSearchContextRunPayload) -> dict:
    """Run Search for a chart document without activating a search tab."""
    try:
        context = workspace_service.search_context_for_document(
            payload.documentId,
            significator_id=payload.significatorId,
            chart_role=payload.chartRole,
            custom_points=payload.customPoints,
        )
        return _transit_search_service_instance().search(
            context["chart"],
            payload.model_dump(),
            custom_points=context.get("custom_points"),
            persist=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/context/settings")
def transit_search_context_settings(payload: TransitSearchContextRunPayload) -> dict:
    """Persist Search controls for a chart document without forcing a result run."""
    try:
        context = workspace_service.search_context_for_document(
            payload.documentId,
            significator_id=payload.significatorId,
            chart_role=payload.chartRole,
            custom_points=payload.customPoints,
        )
        return _transit_search_service_instance().save_settings(
            context["chart"],
            payload.model_dump(),
            custom_points=context.get("custom_points"),
            persist=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/start")
def transit_search_start(payload: TransitSearchPayload) -> dict:
    """Start a retained Search job and return immediately with current rows."""
    try:
        context = workspace_service.search_context(payload.documentId)
        return _transit_search_service_instance().start_search(
            context["chart"],
            payload.model_dump(),
            custom_points=context.get("custom_points"),
            persist=bool(payload.persistSettings) and not bool(context.get("custom_points")),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/context/start")
def transit_search_context_start(payload: TransitSearchContextRunPayload) -> dict:
    """Start right-pane Search without activating a search document."""
    try:
        context = workspace_service.search_context_for_document(
            payload.documentId,
            significator_id=payload.significatorId,
            chart_role=payload.chartRole,
            custom_points=payload.customPoints,
        )
        return _transit_search_service_instance().start_search(
            context["chart"],
            payload.model_dump(),
            custom_points=context.get("custom_points"),
            persist=bool(payload.persistSettings) and not bool(context.get("custom_points")),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/search/progress")
def transit_search_progress(sessionId: str) -> dict:
    try:
        return _transit_search_service_instance().progress(sessionId)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/cancel")
def transit_search_cancel(payload: SearchCancelPayload) -> dict:
    try:
        return _transit_search_service_instance().cancel(payload.sessionId)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/default-range")
def search_default_range(payload: SearchDefaultRangePayload) -> dict:
    try:
        return _transit_search_service_instance().update_default_range(
            payload.offsetMonths,
            payload.rangeMonths,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/search/export")
def search_export(payload: SearchExportPayload) -> dict:
    """Clipboard/ICS text for selected Search rows.

    The strings come from the existing Python brains
    (searchbackend.build_clipboard_text / build_ics) exactly as the wx context
    menu actions call them (searchwnd.py:3733-3756)."""
    try:
        return _transit_search_service_instance().export_rows(payload.rows, payload.kind)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/document/{doc_id}/snapshot")
def workspace_document_snapshot(
    doc_id: str,
    overlay_render_mode: str = "full",
    perf: bool = False,
) -> dict:
    """Render the LIVE in-memory document by id (session-truth render path).

    The skin renders whatever this returns; it never reconstructs a chart from
    name+kind+when. Replaces the /api/chart{,/supplementary,/synastry} render-by-
    parameter calls for any document the workspace already holds."""
    try:
        return workspace_service.document_snapshot(
            doc_id,
            overlay_render_mode=overlay_render_mode,
            include_perf=perf,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open")
def workspace_open(
    payload: WorkspaceOpenPayload,
    perf: bool = Query(default=False),
) -> dict:
    """open_document — root radix or derived child (auto-indented under parent)."""
    try:
        return workspace_service.open_document(
            kind=payload.kind,
            source_name=payload.sourceName,
            source=payload.source,
            record_index=payload.recordIndex,
            parent_document_id=payload.parentDocumentId,
            feature_kind=payload.featureKind,
            comparison_name=payload.comparisonName,
            when_iso=payload.when,
            planet_type=payload.planetType,
            binding_payload=payload.binding,
            reuse_existing=payload.reuseExisting,
            include_perf=perf,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/activate")
def workspace_activate(payload: WorkspaceActivatePayload) -> dict:
    try:
        return workspace_service.activate_document(payload.docId)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/close-preflight")
def workspace_close_preflight(payload: WorkspaceClosePayload) -> dict:
    """Non-destructive: returns promptWorthyIds (the dirty + file-backed +
    owns-radix predicate, computed daemon-side) WITHOUT closing. The React modal
    is shown from this; then /api/workspace/close finalizes. The skin must never
    recompute the predicate."""
    try:
        return workspace_service.close_preflight(payload.docId, cascade=payload.cascade)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/workspace/quit-preflight")
def workspace_quit_preflight() -> dict:
    """App-quit guard (policy-chart-lifecycle §3): returns needsPrompt + the
    bound+dirty radix documents (with labels) the Save/Discard modal must
    confirm before quit. UNBOUND charts auto-persist silently and never prompt.
    Non-destructive — the native CloseRequested handler owns prevent_close."""
    try:
        return workspace_service.quit_preflight()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/close")
def workspace_close(payload: WorkspaceClosePayload) -> dict:
    """close_document — returns closedIds + promptWorthyIds (the dirty +
    file-backed + owns-radix predicate, morin.py:11529-11551). The React modal
    owns the discard/save decision."""
    try:
        return workspace_service.close_document(payload.docId, cascade=payload.cascade)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-synastry")
def workspace_open_synastry(payload: WorkspaceOpenSynastryPayload) -> dict:
    """Open a synastry comparison as a root-level COMPOUND relationship doc
    (biwheel, not a client-side overlay). Mirrors morin.py:8543."""
    try:
        return workspace_service.open_synastry(
            payload.parentRadixId,
            payload.comparisonName,
            comparison_source=payload.comparisonSource,
            comparison_record_index=payload.comparisonRecordIndex,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class WorkspaceOpenLensHereNowPayload(BaseModel):
    discipline: str
    theme: Optional[str] = None


class WorkspaceLensMirrorPayload(BaseModel):
    documentId: str
    lens: Optional[dict] = None


@app.post("/api/workspace/lens-mirror")
def workspace_lens_mirror(payload: WorkspaceLensMirrorPayload) -> dict:
    """Mirror the skin's interpretation lens onto a horary document's chart
    (`chrt.interpretation`) so Save round-trips the question — wx
    morin._mirror_lens_to_horary_session (morin.py:9062-9071). No-op for
    non-horary documents; a null lens clears the slot."""
    try:
        return workspace_service.set_document_lens(payload.documentId, payload.lens)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-lens-here-now")
def workspace_open_lens_here_now(payload: WorkspaceOpenLensHereNowPayload) -> dict:
    """No-chart fallback for a Charts > Elections / Horary theme pick — builds
    the wx here-and-now TRANSIT (elections, morin.py:19082-19101) or HORARY
    (morin.py:19005-19029) chart as a real self-anchored document."""
    try:
        return workspace_service.open_lens_here_now(payload.discipline, payload.theme)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-here-now")
def workspace_open_here_now(payload: WorkspaceOpenHereNowPayload) -> dict:
    """Open Here-and-Now as a real self-anchored workspace document (its own
    daemon cursor), rendered by doc id — replaces the skin fabricating 'now'
    from the browser clock + the by-param /api/chart/here-now path."""
    try:
        return workspace_service.open_here_now(when_iso=payload.when)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-astrocart")
def workspace_open_astrocart(payload: WorkspaceOpenAstrocartPayload) -> dict:
    """Open astrocartography as a lightweight view-only child under the radix
    (no chart session; the map is fetched from /api/astrocart/lines). Mirrors the
    wx workspace table panel morin.py:16208."""
    try:
        return workspace_service.open_astrocart(
            payload.parentRadixId,
            eclipse_jd=payload.eclipseJd,
            eclipse_retflag=payload.eclipseRetflag,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-directions")
def workspace_open_directions(payload: WorkspaceOpenDirectionsPayload) -> dict:
    """Open the Primary Directions list as a lightweight view-only child under
    the radix (no chart session; the list is fetched from /api/directions). Like
    open-astrocart, this owns only the document lifecycle — the PD computation is
    the engine's (directions_service via engine.symbolic_projection)."""
    try:
        return workspace_service.open_directions(
            payload.parentRadixId,
            custom_significator=payload.customSignificator,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-transit-search")
def workspace_open_transit_search(payload: WorkspaceOpenTransitSearchPayload) -> dict:
    """Open the transit search engine as a lightweight view-only child under
    the active/reference chart. The search backend remains ``searchbackend``;
    this route only owns workspace document lifecycle."""
    try:
        return workspace_service.open_transit_search(
            payload.parentDocumentId,
            significator_id=payload.significatorId,
            chart_role=payload.chartRole,
            custom_points=payload.customPoints,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-astrolabe")
def workspace_open_astrolabe(payload: WorkspaceOpenAstrolabePayload) -> dict:
    """Open the planispheric astrolabe as a lightweight view-only child under
    the radix (no chart session; the geometry is fetched from /api/astrolabe).
    Like open-astrocart/open-directions, this owns only the document lifecycle —
    the projection geometry is the engine's (astrolabe_service via
    astrolabe_projection)."""
    try:
        return workspace_service.open_astrolabe(payload.parentRadixId)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-astrolog-sphere")
def workspace_open_astrolog_sphere(payload: WorkspaceOpenAstrologSpherePayload) -> dict:
    """Open the Astrolog-style sphere as a lightweight view-only child under
    the radix. It owns only document lifecycle; projection geometry is fetched
    from /api/astrolog-sphere."""
    try:
        return workspace_service.open_astrolog_sphere(payload.parentRadixId)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-square-chart")
def workspace_open_square_chart(payload: WorkspaceOpenSquareChartPayload) -> dict:
    """Open the Square Chart as a lightweight view-only child under the radix
    (no chart session; data is fetched from /api/square-chart). Owns only the
    document lifecycle; house membership is the engine's (square_chart_service).
    wx twin: SquareChartWnd (squarechartwnd.py)."""
    try:
        return workspace_service.open_square_chart(payload.parentRadixId)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-mundane-chart")
def workspace_open_mundane_chart(payload: WorkspaceOpenMundaneChartPayload) -> dict:
    """Open the Mundane Chart as a lightweight view-only child under the radix
    (no chart session; data is fetched from /api/mundane-chart). Owns only the
    document lifecycle; the mundane positions are the engine's
    (mundane_chart_service). wx twin: MundaneWnd (mundanewnd.py)."""
    try:
        return workspace_service.open_mundane_chart(payload.parentRadixId)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-ephemeris")
def workspace_open_ephemeris(payload: WorkspaceOpenEphemerisPayload) -> dict:
    """Open the Graphic Ephemeris as a lightweight view-only child under the
    radix (no chart session; the curves come from /api/ephemeris). wx twin:
    morin._workspace_table_ephemeris (morin.py:16180-16195)."""
    try:
        return workspace_service.open_ephemeris(payload.parentRadixId)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class WorkspaceAstrocartHerePayload(BaseModel):
    # The astrocart document the right-click happened on (its parent is the
    # radix the four actions derive from). lon/lat are the clicked coordinates;
    # placeName is the MapLibre label hint under the cursor (may be empty).
    astrocartDocumentId: str
    action: str
    lon: float
    lat: float
    placeName: str = ""


@app.post("/api/workspace/astrocart-here")
def workspace_astrocart_here(payload: WorkspaceAstrocartHerePayload) -> dict:
    """Right-click "here" action on the astrocartography map. Mirrors
    morin.on_astrocart_here_request (morin.py:16428), dispatched in wx from the
    map.html #acg-menu via astrocartframe._on_here_request (astrocartframe.py:591).
    Four chart-context actions act on the clicked lon/lat: relocation chart,
    solar revolution here, transit here, set place of birth. The engine builds
    every chart; this route owns only the workspace document lifecycle."""
    try:
        return workspace_service.astrocart_here(
            astrocart_document_id=payload.astrocartDocumentId,
            action=payload.action,
            lon=payload.lon,
            lat=payload.lat,
            place_name=payload.placeName,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class DefaultLocationFromMapPayload(BaseModel):
    # The lon/lat the user clicked on the Settings > Default Location map, plus
    # the MapLibre label hint under the cursor (may be empty — the daemon falls
    # back to the localcities nearest-city reverse geocode).
    lon: float
    lat: float
    placeName: str = ""


@app.post("/api/options/default-location/from-map")
def options_default_location_from_map(payload: DefaultLocationFromMapPayload) -> dict:
    """Write a map-clicked location into the saved default-location options.
    Mirrors morin._astrocart_set_default_location (morin.py:16664), reached in
    wx via the astrocart panel's ``default_location`` context menu "Set default
    location". The webapp launches the same map.html surface (in
    default_location mode) from the Settings > Default Location tab; this route
    handles the returned ``set_default_loc`` action. The Python brain resolves
    the place name + timezone and writes/persists the same ``defloc*`` group the
    Location tab patches, including the map's exact signed decimals, then
    broadcasts options.changed."""
    try:
        return workspace_service.set_default_location_from_map(
            lon=payload.lon,
            lat=payload.lat,
            place_name=payload.placeName,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/tables/{table_id}")
def generic_table_payload(table_id: str, documentId: str = Query(...)) -> dict:
    """Generic embedded table rows for Packet 05A.

    The route resolves the chart from daemon workspace memory, then asks the
    wx-free table service for rows. React renders the payload only; no
    astrology is computed in TypeScript.
    """
    try:
        context = workspace_service.table_context(documentId, requested_table_id=table_id)
        resolved_id = context.get("table_id") or table_id
        if str(resolved_id) != str(table_id):
            raise ValueError(
                f"document {documentId!r} is table {resolved_id!r}, not {table_id!r}"
            )
        return tables_service().payload_for_chart(
            table_id,
            context["chart"],
            binding=context.get("binding"),
            current_datetime=context.get("current_datetime"),
            chart_anchor_datetime=context.get("chart_anchor_datetime"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/synodic/list")
def synodic_list_payload(
    documentId: str = Query(...),
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    planetIds: Optional[str] = Query(None),
    includeStations: bool = Query(True),
    includeCazimis: bool = Query(True),
    includeIngresses: bool = Query(True),
) -> dict:
    try:
        context = workspace_service.table_context(documentId, requested_table_id="synodic_cycles")
        if str(context.get("table_id") or "") != "synodic_cycles":
            raise ValueError(f"document {documentId!r} is not a Synodic Cycles table")
        return synodic_service.payload_for_context(
            context,
            from_date=fromDate,
            to_date=toDate,
            planet_ids=planetIds,
            include_stations=includeStations,
            include_cazimis=includeCazimis,
            include_ingresses=includeIngresses,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-table")
def workspace_open_table(payload: WorkspaceOpenTablePayload) -> dict:
    """Open a generic simple table as a view-only workspace child."""
    try:
        return workspace_service.open_table(
            payload.parentRadixId,
            payload.tableId,
            binding=payload.binding,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/open-ascensional-transits")
def workspace_open_ascensional_transits(payload: WorkspaceOpenAscensionalTransitsPayload) -> dict:
    """Toggle the active chart between its zodiac and Ascensional/MDO views."""
    try:
        return workspace_service.open_ascensional_transits(
            payload.parentRadixId,
            source_document_id=payload.sourceDocumentId,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/ascensional-event-place")
def workspace_ascensional_event_place(payload: WorkspaceAscensionalEventPlacePayload) -> dict:
    """Session-bound Ascensional Transits event-place override.

    Source twin: morin.py:2660-2700 and ascensional_transit_wnd.py:1029-1062.
    The daemon mutates the AT session and rebuilds its event chart; React only
    forwards the chosen place payload.
    """
    try:
        return workspace_service.update_ascensional_event_place(
            payload.documentId,
            payload.place,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/ascensional-event-place/from-map")
def workspace_ascensional_event_place_from_map(
    payload: WorkspaceAscensionalEventPlaceFromMapPayload,
) -> dict:
    """Set an AT event place from the shared astrocart map surface.

    The daemon resolves the clicked lon/lat through the same localcities/name
    path used by default-location map clicks, then applies the ordinary
    session-bound AT place update.
    """
    try:
        return workspace_service.update_ascensional_event_place_from_map(
            payload.documentId,
            lon=payload.lon,
            lat=payload.lat,
            place_name=payload.placeName,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/table-binding")
def workspace_table_binding(payload: WorkspaceTableBindingPayload) -> dict:
    """Update a workspace table document binding and keep chart files clean."""
    try:
        return workspace_service.update_table_binding(
            payload.documentId,
            binding=payload.binding,
            table_id=payload.tableId,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/move")
def workspace_move(payload: WorkspaceMovePayload) -> dict:
    """Reorder a sibling document (DnD reorder). Sibling-only — the model rejects
    a move whose target has a different parent. ``beforeId`` None moves to the end
    of the sibling group. Broadcasts documents.changed with the new tree order."""
    try:
        return workspace_service.move_document(payload.docId, payload.beforeId)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/drag-context")
def workspace_drag_context(payload: WorkspaceDragContextPayload) -> dict:
    """Return daemon-owned DnD context for a workspace document row.

    Source twin: morin._handle_workspace_document_move('query_drag_context')
    (morin.py:10551-10553).
    """
    try:
        return workspace_service.drag_context(payload.docId)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/preview-move-intent")
def workspace_preview_move_intent(payload: WorkspacePreviewMoveIntentPayload) -> dict:
    """Resolve reorder/reparent/detach intent without mutating state."""
    try:
        return workspace_service.preview_move_intent(
            payload.sourceDocumentId,
            target_document_id=payload.targetDocumentId,
            before_id=payload.beforeId,
            root_before_id=payload.rootBeforeId,
            prefer_attach=payload.preferAttach,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/apply-move-intent")
def workspace_apply_move_intent(payload: WorkspaceApplyMoveIntentPayload) -> dict:
    """Apply daemon-resolved reorder/reparent/detach move intent.

    Packet 07C-A scope only: drag-to-synastry and drag-to-transit are not routed
    here.
    """
    try:
        return workspace_service.apply_move_intent(
            payload.sourceDocumentId,
            payload.moveIntent,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/apply-drag-conversion")
def workspace_apply_drag_conversion(payload: WorkspaceApplyDragConversionPayload) -> dict:
    """Apply modifier drag conversions.

    Source twin: morin._handle_workspace_document_move('synastry'/'transit')
    at morin.py:10566-10577; all chart/session construction stays in the
    daemon, not the React sidebar.
    """
    try:
        return workspace_service.apply_drag_conversion(
            payload.action,
            payload.sourceDocumentId,
            payload.targetDocumentId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/navigate")
def workspace_navigate(payload: WorkspaceNavigatePayload) -> dict:
    """Cursor step -> cs.navigate_relative -> session.changed(change_reason='step')."""
    try:
        return workspace_service.navigate(payload.docId, payload.unit, payload.delta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/navigate-key")
def workspace_navigate_key(
    payload: WorkspaceNavigateKeyPayload,
    perf: bool = Query(default=False),
) -> dict:
    """Canonical arrow-key navigation (wx-free twin of
    keyboard_layers.handle_transit_key_event). ``space`` resets; arrows route to
    ChartSession._navigate_intrinsically (transit/root: day/hour/minute/week/
    lunar-phase by modifier) or, for return/progression children, to the
    supplementary year/cycle stepper. Returns the new displayDatetime + stepped.
    Spec: doc/migration/surfaces/arrow-stepping.md."""
    try:
        return workspace_service.navigate_key(
            payload.docId,
            payload.key,
            shift=payload.shift,
            alt=payload.alt,
            repeat=payload.repeat,
            include_perf=perf,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/toggle-comparison")
def workspace_toggle_comparison(payload: WorkspaceToggleComparisonPayload) -> dict:
    """Toggle comparison (biwheel) <-> singleton view for a document (TAB —
    wx-free twin of keyboard_layers TAB -> toggleComparisonView). Flips
    cs.view_mode and returns the new viewMode + a full re-rendered snapshot."""
    try:
        return workspace_service.toggle_comparison(payload.docId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/workspace/synastry-composite")
def workspace_synastry_composite(payload: WorkspaceSynastryCompositePayload) -> dict:
    """Switch an existing synastry document to midpoint/Davison composite or
    back to synastry. The daemon owns composite construction/cache; the document
    id stays stable like morin._open_active_synastry_composite."""
    try:
        return workspace_service.set_synastry_composite(payload.docId, variant=payload.variant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket) -> None:
    """Register the socket with the workspace connection manager and keep it
    open so controller events (documents.changed / active_document.changed /
    session.changed) are pushed to this client."""
    token = _daemon_token()
    if token and _websocket_token(websocket) != token:
        await websocket.close(code=1008)
        return
    await workspace_service.manager.connect(websocket)
    await websocket.send_json({"type": "daemon.ready"})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return
    finally:
        workspace_service.manager.disconnect(websocket)

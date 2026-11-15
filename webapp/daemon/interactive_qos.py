"""Scoped macOS scheduling hints for synchronous user-requested work.

An override preserves the worker's inferred/base QoS and other outstanding
overrides. It does not permanently promote a reused FastAPI worker thread.
"""
from contextlib import contextmanager
import logging
import sys

_log = logging.getLogger(__name__)
_api = None
if sys.platform == "darwin":
    try:
        import ctypes

        _lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        _self = _lib.pthread_self
        _self.argtypes = []
        _self.restype = ctypes.c_void_p
        _start = _lib.pthread_override_qos_class_start_np
        _start.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int]
        _start.restype = ctypes.c_void_p
        _end = _lib.pthread_override_qos_class_end_np
        _end.argtypes = [ctypes.c_void_p]
        _end.restype = ctypes.c_int
        _api = (_self, _start, _end)
    except (OSError, AttributeError):
        _log.warning("macOS interactive QoS API unavailable")


@contextmanager
def user_initiated():
    """Boost only this synchronous request, releasing the hint on every exit."""
    api = _api
    token = api[1](api[0](), 0x19, 0) if api else None  # QOS_CLASS_USER_INITIATED
    try:
        yield
    finally:
        if token:
            api[2](token)

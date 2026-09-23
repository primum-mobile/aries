// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  const geometry = window.AriesRulerGeometry;
  const ns = 'http://www.w3.org/2000/svg';

  window.createAriesMapRuler = function ({ map, pick, resolve, project, onEnabledChange, onDiagnostic, dragThreshold = 6, holdDelay = 160, paranHoldDelay = 180 }) {
    const host = map.getContainer();
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'acg-ruler-overlay');
    svg.setAttribute('aria-hidden', 'true');
    const make = (tag, attributes) => {
      const element = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      svg.appendChild(element);
      return element;
    };
    const halo = make('path', { class: 'acg-ruler-halo' });
    const line = make('path', { class: 'acg-ruler-line' });
    const foot = make('circle', { r: '3', class: 'acg-ruler-foot' });
    const handle = make('circle', { r: '4', class: 'acg-ruler-handle' });
    const label = document.createElement('div');
    label.className = 'acg-ruler-label';
    const hint = document.createElement('div');
    hint.className = 'acg-ruler-hint';
    host.append(svg, label, hint);

    let enabled = false;
    let autoEnabled = false;
    let ready = false;
    let press = null;
    let holdTimer = null;
    let active = true;
    let units = 'metric';
    let locale;
    let selected = null;
    let segments = [];
    let target = null;
    let result = null;
    let path = [];
    let dragging = false;
    let pointerId = null;
    let pending = null;
    let frame = 0;
    let panEnabled = false;
    let zoomEnabled = false;
    let gestureReserved = false;
    let suppressClick = false;
    let diagnostics = false;
    function directMode() { return enabled && !autoEnabled; }
    function holdDuration(selectedLine, direct) {
      if (direct) return holdDelay;
      const zoom = map.getZoom?.();
      const worldView = Number.isFinite(zoom) ? Math.max(0, 4 - zoom) : 0;
      if (selectedLine.features[0]?.properties?.kind === 'PARAN') {
        return paranHoldDelay + Math.min(140, Math.round(worldView * 60));
      }
      return holdDelay + Math.min(100, Math.round(worldView * 50));
    }
    function trace(stage, detail = {}) {
      if (diagnostics) onDiagnostic?.({ stage, active, ready, enabled, ...detail });
    }

    function draw() {
      const visible = active && enabled && !!result;
      svg.style.display = visible ? '' : 'none';
      label.style.display = visible ? '' : 'none';
      hint.style.display = active && enabled && !result ? '' : 'none';
      if (!visible) return;
      let d = '';
      let previous = null;
      for (const coordinate of path) {
        const point = project(coordinate);
        if (!point) { previous = null; continue; }
        // Zoom can put adjacent samples many screens apart. SVG clips those
        // segments to the viewport; only a real longitude-wrap seam breaks them.
        const wrapped = previous && Number.isFinite(previous.longitude) &&
          Number.isFinite(point.longitude) && Math.abs(point.longitude - previous.longitude) > 180;
        const adjacent = previous && !wrapped;
        d += `${adjacent ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
        previous = point;
      }
      halo.setAttribute('d', d);
      line.setAttribute('d', d);
      for (const [element, coordinate] of [[foot, result.coordinate], [handle, target]]) {
        const point = project(coordinate);
        element.style.display = point ? '' : 'none';
        if (point) {
          element.setAttribute('cx', point.x);
          element.setAttribute('cy', point.y);
        }
      }
      const midpoint = project(path[Math.floor(path.length / 2)]) || project(target);
      label.style.display = midpoint ? '' : 'none';
      if (midpoint) {
        label.style.left = `${Math.max(48, Math.min(map.transform.width - 48, midpoint.x))}px`;
        label.style.top = `${Math.max(24, Math.min(map.transform.height - 24, midpoint.y))}px`;
        label.textContent = geometry.formatDistance(result.meters, units, locale);
      }
    }

    function calculate() {
      if (!target || !segments.length) return;
      result = geometry.nearest(segments, target);
      path = result ? geometry.connector(result.coordinate, target) : [];
    }

    function flush() {
      frame = 0;
      if (!active || !enabled) return;
      if (pending) {
        target = pending;
        pending = null;
        calculate();
      }
      draw();
    }

    function pointOf(event) {
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function targetAt(point) {
      const coordinate = map.unproject(point);
      if (!Number.isFinite(coordinate.lng) || !Number.isFinite(coordinate.lat)) return null;
      const value = [coordinate.lng, coordinate.lat];
      const projected = project(value);
      // Reject the space outside the globe; unproject can return a limb point.
      return projected && Math.hypot(projected.x - point.x, projected.y - point.y) < 3 ? value : null;
    }

    function cancelHold() {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      holdTimer = null;
    }

    function finish(event) {
      if (pointerId !== null) trace('finish', { event: event?.type || 'lifecycle', dragging });
      cancelHold();
      if (pointerId === null) return;
      const wasDragging = dragging;
      dragging = false;
      press = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (wasDragging) flush();
      if (panEnabled) map.dragPan.enable();
      if (zoomEnabled) map.doubleClickZoom.enable();
      panEnabled = zoomEnabled = false;
      gestureReserved = false;
      host.classList.remove('acg-ruler-gesture');
      const releasedPointer = pointerId;
      pointerId = null;
      try { map.getCanvas().releasePointerCapture(releasedPointer); } catch (_) {}
    }

    function clear() {
      finish();
      suppressClick = false;
      selected = null;
      segments = [];
      target = result = pending = null;
      path = [];
      draw();
    }

    function disable() {
      clear();
      enabled = false;
      autoEnabled = false;
      host.classList.remove('acg-ruler-enabled');
      host.classList.remove('acg-ruler-explicit');
      draw();
      onEnabledChange(false);
    }

    function down(event) {
      trace('pointerdown', { canvas: event.target === map.getCanvas(), button: event.button,
        pointerType: event.pointerType, busy: pointerId !== null });
      if (!active || !ready || pointerId !== null || event.button !== 0 ||
          event.target !== map.getCanvas()) return;
      suppressClick = false;
      // Preserve modified camera gestures and native multi-touch navigation.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
          (event.pointerType === 'touch' && !enabled)) return;
      const point = pointOf(event);
      const end = enabled && target && project(target);
      const endpointHit = !!(end && Math.hypot(end.x - point.x, end.y - point.y) <= 12);
      const next = endpointHit ? selected : pick(point, { direct: directMode() });
      if (!next || !next.features.length) { trace('no-line-hit'); return; }
      if (!targetAt(point)) { trace('projection-rejected'); return; }
      trace('line-hit', { features: next.features.length });
      press = { point, latestPoint: point, selected: next, direct: directMode() || endpointHit };
      pointerId = event.pointerId;
      if (press.direct) reserveGesture();
      trace('hold-armed');
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        trace('hold-fired', { pressed: !!press });
        if (!active || !ready || !press) return;
        reserveGesture();
        if (activateDrag(press.latestPoint) && !frame) frame = requestAnimationFrame(flush);
      }, holdDuration(next, press.direct));
    }

    function reserveGesture() {
      if (gestureReserved) return;
      gestureReserved = true;
      host.classList.add('acg-ruler-gesture');
      panEnabled = map.dragPan.isEnabled();
      if (panEnabled) map.dragPan.disable();
      map.getCanvas().setPointerCapture(pointerId);
    }

    function activateDrag(point) {
      const coordinate = targetAt(point);
      if (!coordinate) return false;
      const next = press.selected;
      const prepared = next === selected && segments.length ? segments : geometry.prepare(next.features);
      if (!prepared.length) return false;
      cancelHold();
      selected = next;
      segments = prepared;
      press = null;
      dragging = true;
      trace('activated');
      suppressClick = true;
      zoomEnabled = map.doubleClickZoom.isEnabled();
      map.doubleClickZoom.disable();
      if (!enabled) {
        enabled = true;
        autoEnabled = true;
        host.classList.toggle('acg-ruler-enabled', true);
        onEnabledChange(true);
      }
      pending = coordinate;
      return true;
    }

    function move(event) {
      if (event.pointerId !== pointerId) return;
      const point = pointOf(event);
      if (press) {
        press.latestPoint = point;
        if (Math.hypot(point.x - press.point.x, point.y - press.point.y) < dragThreshold) return;
        if (!press.direct && holdTimer !== null) {
          // A quick line-origin drag is map navigation, including at low zoom.
          finish(event);
          return;
        }
        if (!activateDrag(point)) return;
      }
      if (!dragging) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pending = targetAt(point) || pending;
      if (!frame) frame = requestAnimationFrame(flush);
    }

    function up(event) {
      if (event.pointerId !== pointerId) return;
      if (press && press.direct && event.type === 'pointerup') {
        const point = pointOf(event);
        if (Math.hypot(point.x - press.point.x, point.y - press.point.y) >= dragThreshold) activateDrag(point);
      }
      if (dragging) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'pointerup') pending = targetAt(pointOf(event)) || pending;
      }
      finish();
    }

    host.addEventListener('pointerdown', down, true);
    host.addEventListener('pointermove', move, true);
    host.addEventListener('pointerup', up, true);
    host.addEventListener('pointercancel', up, true);
    host.addEventListener('lostpointercapture', finish, true);
    // MapLibre handles mouse events too. Keep the trailing click from opening
    // the selected line's popup or starting a camera drag.
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick']) {
      host.addEventListener(type, (event) => {
        if (event.target !== map.getCanvas()) return;
        if (!dragging && !suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === 'click') suppressClick = false;
      }, true);
    }
    document.addEventListener('keydown', (event) => {
      if ((!enabled && !press) || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      disable();
    }, true);
    // MapLibre emits click only within its click tolerance, so background
    // panning keeps the measurement. The consumed ruler-release click never
    // reaches this handler.
    map.on('click', (event) => {
      if (!active || !ready || !enabled || dragging || press || suppressClick) return;
      const original = event.originalEvent;
      if (!original || original.target !== map.getCanvas() || original.button !== 0 ||
          original.ctrlKey || original.metaKey || original.shiftKey || original.altKey) return;
      const point = event.point;
      const end = target && project(target);
      if (end && Math.hypot(end.x - point.x, end.y - point.y) <= 12) return;
      if (pick(point, { direct: directMode() })?.features.length) return;
      disable();
    });
    map.on('dragstart', () => {
      // Once the map owns a drag, a pending line hold cannot claim it later.
      host.classList.remove('acg-ruler-hover-paran');
      if (press && !gestureReserved) finish();
    });
    window.addEventListener('blur', finish);
    map.on('render', draw);

    return {
      get enabled() { return enabled; },
      configure(options) {
        diagnostics = options.diagnostics === true;
        if (typeof options.ready === 'boolean') {
          ready = options.ready;
          if (!ready) {
            pending = null;
            finish();
            host.classList.remove('acg-ruler-hover-paran');
          }
        }
        if (typeof options.enabled === 'boolean' && enabled !== options.enabled) {
          clear();
          enabled = options.enabled;
          autoEnabled = false;
          host.classList.toggle('acg-ruler-enabled', enabled);
        }
        host.classList.toggle('acg-ruler-explicit', directMode());
        if (options.units === 'metric' || options.units === 'miles') units = options.units;
        if (options.locale) locale = options.locale;
        if (options.hint) hint.textContent = options.hint;
        for (const [key, value] of Object.entries(options.tokens || {})) {
          if (key.startsWith('--aries-') && typeof value === 'string') host.style.setProperty(key, value);
        }
        draw();
        trace('configured');
      },
      setActive(value) {
        // A hidden retained map must have no pending measurement work.
        active = !!value;
        if (!active) {
          pending = null;
          finish();
          host.classList.remove('acg-ruler-hover-paran');
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
        }
        draw();
      },
      setParanHover(value) {
        host.classList.toggle('acg-ruler-hover-paran',
          !!value && active && ready && !map.isMoving?.());
      },
      refresh() {
        if (!active || !selected) return;
        const next = resolve(selected);
        if (!next || !next.features.length) { clear(); return; }
        if (next.features.length !== selected.features.length ||
            next.features.some((feature, i) => feature !== selected.features[i])) {
          selected = next;
          segments = geometry.prepare(next.features);
          calculate();
        }
        draw();
      },
    };
  };
})();

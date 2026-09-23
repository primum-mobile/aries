'use client';
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId, type ReactNode } from 'react';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n/i18n';
import { WHEEL_RING_ARCHETYPES, compatibleRingOrder, moveWheelRing, type WheelComposition, type WheelRingArchetypeId, type WheelRingInstance } from '@/lib/chart/wheel-composition';
import type { WheelTypographyProfile } from '@/lib/chart/wheel-render-style';

// Keyboard reordering uses the existing labelled outward/inward buttons.
// Suppress dnd-kit's default English pointer-drag announcements.
const pointerAnnouncements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

function SortableRingRow({id, fixed, children}: {id: string; fixed: boolean; children: ReactNode}) {
  const t = useT();
  const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} =
    useSortable({id, disabled: fixed});
  return <div ref={setNodeRef} className="relative flex items-center gap-2" style={{
    transform: CSS.Transform.toString(transform), transition,
    zIndex: isDragging ? 1 : undefined,
  }}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
      tabIndex={-1} disabled={fixed} title={t('wheelComposition.drag')} aria-label={t('wheelComposition.drag')}
      className="touch-none cursor-grab active:cursor-grabbing disabled:invisible">
      <GripVertical size={14} />
    </button>
    {children}
  </div>;
}

/** One controlled ring list for Settings and the editor. The daemon validates
 * structure; the editor supplies selection and width authoring in the same row. */
export function WheelCompositionControls({ composition, profile, onChange, selectedRingId, onSelectRing, renderRingControls }: {
  composition: WheelComposition;
  profile: WheelTypographyProfile;
  onChange: (composition: WheelComposition) => void;
  selectedRingId?: string;
  onSelectRing?: (ring: WheelRingInstance) => void;
  renderRingControls?: (ring: WheelRingInstance) => ReactNode;
}) {
  const t = useT();
  const dragId = useId();
  const sensors = useSensors(useSensor(PointerSensor, {activationConstraint: {distance: 4}}));
  const rings = composition.rings;
  const moved = (index: number, delta: number) => {
    const target = rings[index + delta];
    return target ? moveWheelRing(composition, rings[index].instanceId, target.instanceId) : null;
  };
  const move = (index: number, delta: number) => {
    const next = moved(index, delta);
    if (next) onChange(next);
  };
  const available = (Object.keys(WHEEL_RING_ARCHETYPES) as WheelRingArchetypeId[]).filter(kind =>
    !rings.some(ring => ring.archetypeId === kind)
    && WHEEL_RING_ARCHETYPES[kind].projections.includes(composition.projection)
    && WHEEL_RING_ARCHETYPES[kind].layouts.includes(profile));
  return <fieldset className="my-3 space-y-1 rounded border border-[color:var(--aries-inspector-divider-color)] p-2">
    <legend>{t('wheelComposition.title')}</legend>
    <DndContext key={profile} id={dragId} sensors={sensors}
      accessibility={{announcements: pointerAnnouncements, screenReaderInstructions: {draggable: t('wheelComposition.reorderKeys')}}}
      collisionDetection={args => closestCenter({...args, droppableContainers: args.droppableContainers.filter(target =>
        moveWheelRing(composition, String(args.active.id), String(target.id)) !== null)})}
      onDragEnd={({active, over}) => {
        if (!over || active.id === over.id) return;
        const next = moveWheelRing(composition, String(active.id), String(over.id));
        if (next) onChange(next);
      }}>
    <SortableContext items={rings.map(ring => ring.instanceId)} strategy={verticalListSortingStrategy}>
    {rings.map((ring, index) => {
      const spec = WHEEL_RING_ARCHETYPES[ring.archetypeId];
      const core = ring.archetypeId === 'hub';
      const compatible = spec.projections.includes(composition.projection);
      return <SortableRingRow key={ring.instanceId} id={ring.instanceId} fixed={core}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input id={`${dragId}-${ring.instanceId}`} type="checkbox" checked={ring.enabled} aria-label={t(spec.labelKey)} disabled={core || !compatible || (!ring.enabled && !compatibleRingOrder({...composition, rings: rings.map(item => item.instanceId === ring.instanceId ? {...item, enabled: true} : item)}))}
            onChange={event => onChange({...composition, rings: rings.map(item => item.instanceId === ring.instanceId ? {...item, enabled: event.target.checked} : item)})} />
          {onSelectRing ? <button type="button" aria-pressed={selectedRingId === ring.instanceId}
            className="min-w-0 flex-1 rounded-[var(--aries-radius-control-compact)] px-1 text-left hover:bg-[var(--aries-navbar-hover-bg)] aria-pressed:bg-[var(--aries-navbar-hover-bg)] aria-pressed:text-[color:var(--aries-inspector-title-color)]"
            onClick={() => onSelectRing(ring)}>{t(spec.labelKey)}</button>
            : <label className="flex-1" htmlFor={`${dragId}-${ring.instanceId}`}>{t(spec.labelKey)}</label>}
        </div>
        {renderRingControls?.(ring)}
        <button type="button" title={t('wheelComposition.outward')} aria-label={t('wheelComposition.outward')} disabled={!moved(index, -1)} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
        <button type="button" title={t('wheelComposition.inward')} aria-label={t('wheelComposition.inward')} disabled={!moved(index, 1)} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
        <button type="button" title={t('wheelComposition.remove')} aria-label={t('wheelComposition.remove')} disabled={core} onClick={() => onChange({...composition, rings: rings.filter(item => item.instanceId !== ring.instanceId)})}><Trash2 size={14} /></button>
      </SortableRingRow>;
    })}
    </SortableContext>
    </DndContext>
    {available.length > 0 && <label className="flex items-center gap-2">
      <Plus size={14} />
      <select data-aries-surface="control" value="" aria-label={t('wheelComposition.add')} onChange={event => {
        const kind = event.target.value as WheelRingArchetypeId;
        if (!kind) return;
        const ring = {instanceId: `${profile}-${kind}`, archetypeId: kind, enabled: true,
          chartRole: WHEEL_RING_ARCHETYPES[kind].chartRole as 'primary' | 'outer'};
        for (let index = 0; index < rings.length; index += 1) {
          const candidate = {...composition, rings: [...rings.slice(0, index), ring, ...rings.slice(index)]};
          if (compatibleRingOrder(candidate)) { onChange(candidate); break; }
        }
      }}>
        <option value="">{t('wheelComposition.add')}</option>
        {available.map(kind => <option key={kind} value={kind}>{t(WHEEL_RING_ARCHETYPES[kind].labelKey)}</option>)}
      </select>
    </label>}
  </fieldset>;
}

// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  IlamyCalendar,
  dayjs,
  useIlamyCalendarContext,
  type CalendarEvent,
  type CalendarView,
  type EventFormProps,
  type IlamyCalendarProps,
} from "@ilamy/calendar";

import "dayjs/locale/de";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/hu";
import "dayjs/locale/it";
import "dayjs/locale/ko";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";
import "dayjs/locale/zh-tw";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type CalendarEventState,
} from "@/stores/workspace-store";

import { PaneToolbarButton } from "./list-controls";

const DAYJS_LOCALE = {
  de: "de",
  en: "en",
  es: "es",
  fr: "fr",
  hu: "hu",
  it: "it",
  ko: "ko",
  ru: "ru",
  "zh-Hans": "zh-cn",
  "zh-Hant": "zh-tw",
} as const;

const CALENDAR_VIEWS = ["month", "week", "day"] as const;

type CalendarDropIntent = {
  eventId: string;
  cellStart: string;
  cellAllDay: boolean;
  capturedAt: number;
};

type CalendarPointerStart = {
  eventId: string;
  clientX: number;
  clientY: number;
};

function moveEventToCell(
  currentEvent: CalendarEvent,
  proposedEvent: CalendarEvent,
  dropIntent: CalendarDropIntent,
): CalendarEvent {
  const cellStart = dayjs(dropIntent.cellStart);
  const targetStart = dropIntent.cellAllDay
    ? currentEvent.allDay
      ? cellStart.startOf("day")
      : cellStart
          .startOf("day")
          .hour(currentEvent.start.hour())
          .minute(currentEvent.start.minute())
          .second(currentEvent.start.second())
          .millisecond(currentEvent.start.millisecond())
    : cellStart;
  const targetEnd = currentEvent.allDay
    ? targetStart.add(
        currentEvent.end
          .startOf("day")
          .diff(currentEvent.start.startOf("day"), "day"),
        "day",
      )
    : targetStart.add(currentEvent.end.diff(currentEvent.start, "millisecond"), "millisecond");

  return {
    ...currentEvent,
    start: targetStart,
    end: targetEnd,
    allDay: dropIntent.cellAllDay ? currentEvent.allDay : proposedEvent.allDay,
  };
}

function isSameStoredEvent(left: CalendarEvent, right: CalendarEvent) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.start.isSame(right.start) &&
    left.end.isSame(right.end) &&
    Boolean(left.allDay) === Boolean(right.allDay) &&
    left.color === right.color &&
    left.backgroundColor === right.backgroundColor &&
    left.description === right.description &&
    left.location === right.location
  );
}

function CalendarEventCorrection({
  event,
  suppressUpdateRef,
}: {
  event: CalendarEvent | null;
  suppressUpdateRef: React.MutableRefObject<boolean>;
}) {
  const { rawEvents, updateEvent } = useIlamyCalendarContext();

  React.useLayoutEffect(() => {
    if (!event) return;
    const currentEvent = rawEvents.find((current) => current.id === event.id);
    if (!currentEvent || isSameStoredEvent(currentEvent, event)) return;
    suppressUpdateRef.current = true;
    updateEvent(event.id, event);
  }, [event, rawEvents, suppressUpdateRef, updateEvent]);

  return null;
}

function toStoredEvent(event: CalendarEvent): CalendarEventState {
  return {
    id: event.id,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay,
    color: event.color,
    backgroundColor: event.backgroundColor,
    description: event.description,
    location: event.location,
  };
}

function fromStoredEvent(event: CalendarEventState): CalendarEvent {
  return {
    ...event,
    start: dayjs(event.start),
    end: dayjs(event.end),
  };
}

function CalendarPrototypeHeader({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { currentDate, nextPeriod, openEventForm, prevPeriod, setView, today, view } =
    useIlamyCalendarContext();
  const title = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }).format(currentDate.toDate()),
    [currentDate, locale],
  );

  const createEvent = React.useCallback(() => {
    const start = currentDate.startOf("day").hour(9);
    openEventForm({ start, end: start.add(1, "hour") });
  }, [currentDate, openEventForm]);

  return (
    <div className="shrink-0 border-b border-[color:var(--aries-border-subtle)]">
      <div className="flex items-center gap-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]">
        <PaneToolbarButton
          appearance="ghost"
          square
          onClick={onClose}
          aria-label={t("calendar.close")}
        >
          <X />
        </PaneToolbarButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-text-primary)]">
            {t("sidebar.action.table:calendar")}
          </div>
          <div className="truncate text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-text-muted)]">
            {title}
          </div>
        </div>
        <PaneToolbarButton appearance="outline" onClick={createEvent}>
          <Plus />
          {t("calendar.newEvent")}
        </PaneToolbarButton>
      </div>
      <div className="flex items-center gap-[var(--aries-control-gap-compact)] border-t border-[color:var(--aries-border-subtle)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-compact-padding-y)]">
        <PaneToolbarButton
          appearance="ghost"
          square
          onClick={prevPeriod}
          aria-label={t("calendar.previousPeriod")}
        >
          <ChevronLeft />
        </PaneToolbarButton>
        <PaneToolbarButton appearance="outline" onClick={today}>
          {t("calendar.today")}
        </PaneToolbarButton>
        <PaneToolbarButton
          appearance="ghost"
          square
          onClick={nextPeriod}
          aria-label={t("calendar.nextPeriod")}
        >
          <ChevronRight />
        </PaneToolbarButton>
        <div className="ml-auto flex items-center gap-[var(--aries-control-gap-compact)]" role="group">
          {CALENDAR_VIEWS.map((calendarView) => (
            <PaneToolbarButton
              key={calendarView}
              appearance={view === calendarView ? "outline" : "ghost"}
              aria-pressed={view === calendarView}
              onClick={() => setView(calendarView)}
            >
              {t(`calendar.${calendarView}`)}
            </PaneToolbarButton>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarEventContent({
  event,
  selected,
  onSelect,
}: {
  event: CalendarEvent;
  selected: boolean;
  onSelect: (event: CalendarEvent) => void;
}) {
  const t = useT();
  const { deleteEvent, openEventForm } = useIlamyCalendarContext();
  const timeRange = event.allDay
    ? null
    : `${event.start.format("HH:mm")}–${event.end.format("HH:mm")}`;
  const backgroundClass = event.backgroundColor?.startsWith("bg-")
    ? event.backgroundColor
    : "bg-primary";
  const foregroundClass = event.color?.startsWith("text-")
    ? event.color
    : "text-primary-foreground";
  const eventStyle = {
    backgroundColor: event.backgroundColor?.startsWith("bg-")
      ? undefined
      : event.backgroundColor,
    color: event.color?.startsWith("text-") ? undefined : event.color,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-full w-full items-center gap-[var(--aries-control-gap-compact)] overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-surface)] px-[var(--aries-control-padding-x-compact)] text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aries-focus-ring)]",
              selected &&
                "ring-2 ring-inset ring-[color:var(--aries-focus-ring)]",
              backgroundClass,
              foregroundClass,
            )}
            data-aries-calendar-event=""
            data-aries-calendar-event-id={String(event.id)}
            aria-pressed={selected}
            style={eventStyle}
            title={timeRange ? `${timeRange} ${event.title}` : event.title}
            onContextMenu={() => onSelect(event)}
            onDoubleClick={(mouseEvent) => {
              mouseEvent.stopPropagation();
              onSelect(event);
              openEventForm(event);
            }}
          />
        }
      >
        {timeRange ? (
          <span className="shrink-0 tabular-nums font-normal opacity-75">
            {timeRange}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{event.title}</span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => openEventForm(event)}>
          {t("calendar.edit")}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => deleteEvent(event.id)}>
          {t("calendar.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CalendarEventEditor({
  selectedEvent,
  onAdd,
  onClose,
  onDelete,
  onUpdate,
}: EventFormProps) {
  const t = useT();
  const titleId = React.useId();
  const startId = React.useId();
  const endId = React.useId();
  const allDayId = React.useId();
  const isExisting = selectedEvent?.id !== undefined && selectedEvent?.id !== null;
  const initialStart = selectedEvent?.start ?? dayjs().startOf("hour");
  const initialEnd = selectedEvent?.end ?? initialStart.add(1, "hour");
  const [title, setTitle] = React.useState(selectedEvent?.title ?? "");
  const [allDay, setAllDay] = React.useState(Boolean(selectedEvent?.allDay));
  const [start, setStart] = React.useState(
    initialStart.format(selectedEvent?.allDay ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm"),
  );
  const [end, setEnd] = React.useState(
    initialEnd.format(selectedEvent?.allDay ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm"),
  );
  const parsedStart = dayjs(start);
  const parsedEnd = dayjs(end);
  const validRange =
    parsedStart.isValid() &&
    parsedEnd.isValid() &&
    (allDay
      ? !parsedEnd.isBefore(parsedStart, "day")
      : parsedEnd.isAfter(parsedStart));
  const canSave = title.trim().length > 0 && validRange;

  const setAllDayMode = React.useCallback(
    (checked: boolean) => {
      const previousStart = dayjs(start);
      const previousEnd = dayjs(end);
      setAllDay(checked);
      setStart(previousStart.format(checked ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm"));
      setEnd(previousEnd.format(checked ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm"));
    },
    [end, start],
  );

  const save = React.useCallback(
    (submitEvent: React.FormEvent) => {
      submitEvent.preventDefault();
      if (!canSave) return;
      const event: CalendarEvent = {
        ...selectedEvent,
        id: selectedEvent?.id ?? crypto.randomUUID(),
        title: title.trim(),
        start: allDay ? parsedStart.startOf("day") : parsedStart,
        end: allDay ? parsedEnd.startOf("day") : parsedEnd,
        allDay,
        backgroundColor: selectedEvent?.backgroundColor ?? "bg-primary",
        color: selectedEvent?.color ?? "text-primary-foreground",
      };
      if (isExisting) onUpdate?.(event);
      else onAdd?.(event);
      onClose();
    },
    [
      allDay,
      canSave,
      isExisting,
      onAdd,
      onClose,
      onUpdate,
      parsedEnd,
      parsedStart,
      selectedEvent,
      title,
    ],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} size="sm">
        <DialogHeader>
          <DialogTitle>
            {t(isExisting ? "calendar.editEvent" : "calendar.createEvent")}
          </DialogTitle>
        </DialogHeader>
        <form className="grid gap-[var(--aries-dialog-gap)]" onSubmit={save}>
          <label className="grid gap-[var(--aries-control-gap-compact)]" htmlFor={titleId}>
            <span>{t("calendar.title")}</span>
            <Input
              id={titleId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="inline-flex items-center gap-[var(--aries-control-gap)]" htmlFor={allDayId}>
            <input
              id={allDayId}
              type="checkbox"
              checked={allDay}
              onChange={(event) => setAllDayMode(event.target.checked)}
              data-aries-control-appearance="local"
              className="size-[var(--aries-control-icon-size-default)] accent-[color:var(--aries-accent)]"
            />
            <span>{t("calendar.allDay")}</span>
          </label>
          <div className="grid grid-cols-2 gap-[var(--aries-dialog-gap)]">
            <label className="grid gap-[var(--aries-control-gap-compact)]" htmlFor={startId}>
              <span>{t("calendar.start")}</span>
              <Input
                id={startId}
                type={allDay ? "date" : "datetime-local"}
                step={allDay ? undefined : 900}
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </label>
            <label className="grid gap-[var(--aries-control-gap-compact)]" htmlFor={endId}>
              <span>{t("calendar.end")}</span>
              <Input
                id={endId}
                type={allDay ? "date" : "datetime-local"}
                step={allDay ? undefined : 900}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                aria-invalid={!validRange}
                required
              />
            </label>
          </div>
          <DialogFooter className="mt-[var(--aries-dialog-gap)]">
            {isExisting && selectedEvent ? (
              <Button
                type="button"
                variant="destructive"
                className="sm:mr-auto"
                onClick={() => {
                  onDelete?.(selectedEvent);
                  onClose();
                }}
              >
                {t("calendar.delete")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              {t("calendar.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t("calendar.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function renderCalendarEventForm(props: EventFormProps) {
  if (!props.open) return null;
  const eventKey = props.selectedEvent?.id ?? props.selectedEvent?.start?.valueOf() ?? "new";
  return <CalendarEventEditor key={eventKey} {...props} />;
}

export function CalendarPrototypeView({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const calendarRootRef = React.useRef<HTMLDivElement>(null);
  const [selectedEventId, setSelectedEventId] = React.useState<
    CalendarEvent["id"] | null
  >(null);
  const pointerStartRef = React.useRef<CalendarPointerStart | null>(null);
  const dropIntentRef = React.useRef<CalendarDropIntent | null>(null);
  const suppressCorrectionUpdateRef = React.useRef(false);
  const [dragCorrection, setDragCorrection] = React.useState<CalendarEvent | null>(null);
  const calendarEvents = useWorkspaceStore((state) => state.calendarEvents);
  const calendarView = useWorkspaceStore((state) => state.calendarView);
  const calendarViewDate = useWorkspaceStore((state) => state.calendarViewDate);
  const setCalendarEvents = useWorkspaceStore((state) => state.setCalendarEvents);
  const setCalendarView = useWorkspaceStore((state) => state.setCalendarView);
  const setCalendarViewDate = useWorkspaceStore((state) => state.setCalendarViewDate);
  const today = React.useMemo(() => dayjs().startOf("day"), []);
  const sampleEvents = React.useMemo<NonNullable<IlamyCalendarProps["events"]>>(
    () => [
      {
        id: "prototype-planning",
        title: t("calendar.samplePlanning"),
        start: today.add(1, "day").hour(10),
        end: today.add(1, "day").hour(11).minute(30),
        backgroundColor: "bg-primary",
        color: "text-primary-foreground",
      },
      {
        id: "prototype-review",
        title: t("calendar.sampleReview"),
        start: today.add(4, "day"),
        end: today.add(6, "day"),
        allDay: true,
        backgroundColor: "bg-secondary",
        color: "text-secondary-foreground",
      },
    ],
    [t, today],
  );
  const events = React.useMemo(
    () => calendarEvents?.map(fromStoredEvent) ?? sampleEvents,
    [calendarEvents, sampleEvents],
  );
  const eventsRef = React.useRef(events);
  React.useLayoutEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const replaceEvents = React.useCallback(
    (nextEvents: CalendarEvent[]) => {
      eventsRef.current = nextEvents;
      setCalendarEvents(nextEvents.map(toStoredEvent));
    },
    [setCalendarEvents],
  );
  const addEvent = React.useCallback(
    (event: CalendarEvent) => replaceEvents([...eventsRef.current, event]),
    [replaceEvents],
  );
  const updateEvent = React.useCallback(
    (event: CalendarEvent) => {
      if (suppressCorrectionUpdateRef.current) {
        suppressCorrectionUpdateRef.current = false;
        return;
      }
      const currentEvent = eventsRef.current.find((current) => current.id === event.id);
      if (!currentEvent) return;

      const pendingDrop = dropIntentRef.current;
      const isCurrentDrop =
        pendingDrop !== null &&
        pendingDrop.eventId === String(event.id) &&
        performance.now() - pendingDrop.capturedAt < 500;
      dropIntentRef.current = null;
      const nextEvent = isCurrentDrop
        ? moveEventToCell(currentEvent, event, pendingDrop)
        : event;
      setDragCorrection(isCurrentDrop ? nextEvent : null);
      replaceEvents(
        eventsRef.current.map((current) =>
          current.id === nextEvent.id ? nextEvent : current,
        ),
      );
    },
    [replaceEvents],
  );
  const deleteEvent = React.useCallback(
    (event: CalendarEvent) => {
      setDragCorrection(null);
      setSelectedEventId((current) => (current === event.id ? null : current));
      replaceEvents(eventsRef.current.filter((current) => current.id !== event.id));
    },
    [replaceEvents],
  );
  const selectEvent = React.useCallback((event: CalendarEvent) => {
    dropIntentRef.current = null;
    setSelectedEventId(event.id);
    calendarRootRef.current?.focus({ preventScroll: true });
  }, []);
  const handleCalendarKeyDown = React.useCallback(
    (keyboardEvent: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        selectedEventId === null ||
        (keyboardEvent.key !== "Backspace" && keyboardEvent.key !== "Delete")
      ) {
        return;
      }

      const target = keyboardEvent.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      ) {
        return;
      }

      const selectedEvent = events.find((event) => event.id === selectedEventId);
      if (!selectedEvent) {
        setSelectedEventId(null);
        return;
      }

      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      deleteEvent(selectedEvent);
    },
    [deleteEvent, events, selectedEventId],
  );

  return (
    <div
      ref={calendarRootRef}
      className="aries-calendar-prototype font-morinus-text h-full min-h-0 bg-[color:var(--aries-surface)] text-[color:var(--aries-panel-text)] outline-none"
      tabIndex={-1}
      onKeyDown={handleCalendarKeyDown}
      onPointerDownCapture={(pointerEvent) => {
        const target = pointerEvent.target;
        const eventTarget =
          target instanceof Element
            ? target.closest<HTMLElement>("[data-aries-calendar-event]")
            : null;
        if (!eventTarget) {
          pointerStartRef.current = null;
          setSelectedEventId(null);
          return;
        }
        if (pointerEvent.button === 0) {
          pointerStartRef.current = {
            eventId: eventTarget.dataset.ariesCalendarEventId ?? "",
            clientX: pointerEvent.clientX,
            clientY: pointerEvent.clientY,
          };
        }
      }}
      onPointerUpCapture={(pointerEvent) => {
        const pointerStart = pointerStartRef.current;
        pointerStartRef.current = null;
        if (
          !pointerStart ||
          Math.hypot(
            pointerEvent.clientX - pointerStart.clientX,
            pointerEvent.clientY - pointerStart.clientY,
          ) < 2
        ) {
          return;
        }

        const dropCell = document
          .elementsFromPoint(pointerEvent.clientX, pointerEvent.clientY)
          .map((element) => element.closest<HTMLElement>(".droppable-cell"))
          .find((element): element is HTMLElement => Boolean(element));
        const cellStart = dropCell?.dataset.start;
        if (!dropCell || !cellStart || dropCell.dataset.disabled === "true") return;
        dropIntentRef.current = {
          eventId: pointerStart.eventId,
          cellStart,
          cellAllDay: dropCell.dataset.allDay === "true",
          capturedAt: performance.now(),
        };
      }}
      onPointerCancel={() => {
        pointerStartRef.current = null;
        dropIntentRef.current = null;
      }}
    >
      <IlamyCalendar
        events={events}
        initialView={calendarView}
        initialDate={calendarViewDate ?? undefined}
        firstDayOfWeek="monday"
        locale={DAYJS_LOCALE[locale]}
        timeFormat="24-hour"
        hideExportButton
        stickyViewHeader
        headerComponent={
          <>
            <CalendarEventCorrection
              event={dragCorrection}
              suppressUpdateRef={suppressCorrectionUpdateRef}
            />
            <CalendarPrototypeHeader onClose={onClose} />
          </>
        }
        renderEvent={(event) => (
          <CalendarEventContent
            event={event}
            selected={event.id === selectedEventId}
            onSelect={selectEvent}
          />
        )}
        renderEventForm={renderCalendarEventForm}
        onEventClick={selectEvent}
        onDateChange={(date) => setCalendarViewDate(date.format("YYYY-MM-DD"))}
        onViewChange={(view: CalendarView) => {
          if (view === "month" || view === "week" || view === "day") setCalendarView(view);
        }}
        onEventAdd={addEvent}
        onEventUpdate={updateEvent}
        onEventDelete={deleteEvent}
      />
    </div>
  );
}

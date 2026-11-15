"use client";

/**
 * Type-ahead place field shared by the chart editor's birth place and the
 * Default Location settings tab. Coordinate queries resolve to one exact point
 * in the daemon. Other queries list cities from the daemon first, then OpenStreetMap addresses from
 * Photon, biased toward `bias`. Picking a city hands its form-shaped
 * candidate to `onPick` directly; picking an address asks the daemon
 * (`placeAt`) for the same shape — timezone, altitude, DMS split — first.
 *
 * The field text stays caller-owned (`value`/`onValueChange`) so the chart
 * editor's place name remains freely editable.
 */

import * as React from "react";

import { placeAt, resolvePlace, type PlaceCandidate } from "@/lib/daemon/client";
import { searchPhoton, type PhotonBias, type PhotonPlace } from "@/lib/geocode/photon";
import { isExactPlaceName, isPlaceNamePrefix } from "@/lib/geocode/place-name-match";
import { useLocale, useT } from "@/lib/i18n/i18n";

const MIN_QUERY = 3;
const CITY_DEBOUNCE_MS = 150;
const ADDRESS_DEBOUNCE_MS = 350;
const CITY_LIMIT = 5;
const ADDRESS_LIMIT = 6;

type Row =
  | { kind: "city"; city: PlaceCandidate }
  | { kind: "address"; address: PhotonPlace };

type SearchState = {
  query: string;
  cities: PlaceCandidate[];
  addresses: PhotonPlace[];
  citiesPending: boolean;
  addressesPending: boolean;
};

const EMPTY: SearchState = {
  query: "",
  cities: [],
  addresses: [],
  citiesPending: false,
  addressesPending: false,
};

export function PlaceSearchField({
  value,
  onValueChange,
  onPick,
  bias,
  placeholder,
  ariaLabel,
  inputClassName,
}: {
  value: string;
  onValueChange: (text: string) => void;
  onPick: (candidate: PlaceCandidate) => void;
  bias?: PhotonBias | null;
  placeholder: string;
  ariaLabel: string;
  inputClassName: string;
}) {
  const t = useT();
  const locale = useLocale();
  const listId = React.useId();
  const [state, setState] = React.useState<SearchState>(EMPTY);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [picking, setPicking] = React.useState(false);
  const versionRef = React.useRef(0);
  const controllerRef = React.useRef<AbortController | null>(null);
  const timersRef = React.useRef<number[]>([]);
  const biasRef = React.useRef(bias);
  React.useEffect(() => {
    biasRef.current = bias;
  }, [bias]);

  const cancel = React.useCallback(() => {
    versionRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  React.useEffect(() => cancel, [cancel]);

  const search = React.useCallback(
    (raw: string) => {
      cancel();
      const query = raw.trim();
      if (query.length < MIN_QUERY) {
        setState(EMPTY);
        setOpen(false);
        return;
      }
      const version = versionRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;
      const live = () => version === versionRef.current;
      const mayBeCoordinates = /^[+−.\d-]/.test(query);
      setState((prev) => ({
        query,
        cities: !mayBeCoordinates && prev.query && query.startsWith(prev.query) ? prev.cities : [],
        addresses: !mayBeCoordinates && prev.query && query.startsWith(prev.query) ? prev.addresses : [],
        citiesPending: true,
        addressesPending: true,
      }));
      setActive(0);
      setOpen(true);
      timersRef.current.push(window.setTimeout(async () => {
        // Only numeric input can be a coordinate. Resolve it locally before
        // submitting a numbered address or any other query to a geocoder.
        if (mayBeCoordinates) {
          const points = await resolvePlace(query, controller.signal, true).catch(() => []);
          if (!live()) return;
          if (points.length) {
            setState({ ...EMPTY, query, cities: points });
            return;
          }
        }
        void resolvePlace(query, controller.signal)
          .then((rows) => {
            if (live()) setState((s) => ({ ...s, cities: rows.slice(0, CITY_LIMIT), citiesPending: false }));
          })
          .catch(() => {
            if (live()) setState((s) => ({ ...s, cities: [], citiesPending: false }));
          });
        timersRef.current.push(window.setTimeout(() => {
          void searchPhoton(query, {
            bias: biasRef.current,
            locale,
            limit: ADDRESS_LIMIT,
            signal: controller.signal,
          })
            .then((rows) => {
              if (live()) setState((s) => ({ ...s, addresses: rows, addressesPending: false }));
            })
            .catch(() => {
              // Offline or rate-limited: the city section keeps working.
              if (live()) setState((s) => ({ ...s, addresses: [], addressesPending: false }));
            });
        }, ADDRESS_DEBOUNCE_MS - CITY_DEBOUNCE_MS));
      }, CITY_DEBOUNCE_MS));
    },
    [cancel, locale],
  );

  const cities = React.useMemo(() => {
    const exactAddress = state.addresses.some((address) => isExactPlaceName(state.query, address.name));
    return state.cities.filter((city) =>
      isExactPlaceName(state.query, city.name) ||
      (!exactAddress && (isPlaceNamePrefix(state.query, city.name) || !state.addressesPending))
    );
  }, [state.addresses, state.addressesPending, state.cities, state.query]);
  const rows: Row[] = React.useMemo(
    () => [
      ...cities.map((city) => ({ kind: "city" as const, city })),
      ...state.addresses.map((address) => ({ kind: "address" as const, address })),
    ],
    [cities, state.addresses],
  );

  const close = () => {
    cancel();
    setOpen(false);
    setState(EMPTY);
  };

  const pick = (row: Row) => {
    close();
    if (row.kind === "city") {
      onValueChange(row.city.label);
      onPick(row.city);
      return;
    }
    const { address } = row;
    onValueChange(address.label);
    setPicking(true);
    placeAt(address.lon, address.lat, address.label)
      .then(onPick)
      .catch((err) => console.error("[place-search]", err))
      .finally(() => setPicking(false));
  };

  const pending = state.citiesPending || state.addressesPending;
  const showHeadings = cities.length > 0 && (state.addresses.length > 0 || state.addressesPending);
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));

  const rowClass = (index: number) =>
    "flex w-full items-baseline justify-between gap-[var(--aries-form-row-gap)] px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-padding-y)] text-left " +
    (index === activeIndex ? "bg-muted" : "hover:bg-muted");
  const headingClass =
    "px-[var(--aries-control-padding-x-compact)] pb-[calc(var(--aries-control-gap-compact)/2)] pt-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] text-foreground/45";
  const noteClass =
    "px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] text-foreground/55";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[var(--aries-control-gap)]">
      <input
        data-aries-control-appearance="local"
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-busy={picking || undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onValueChange(e.target.value);
          search(e.target.value);
        }}
        onBlur={() => {
          setOpen(false);
          cancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (open && rows[activeIndex]) pick(rows[activeIndex]);
            else if (!open) search(value);
            return;
          }
          if (!open || rows.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(rows.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          }
        }}
        className={inputClassName}
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-60 overflow-y-auto rounded-[var(--aries-radius-control-compact)] border border-border/50"
        >
          {showHeadings ? <div className={headingClass}>{t("placeSearch.cities")}</div> : null}
          {cities.map((city, i) => (
            <button
              key={`city-${city.label}-${city.lat}-${city.lon}`}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                pick({ kind: "city", city });
              }}
              onMouseEnter={() => setActive(i)}
              className={rowClass(i)}
            >
              <span className="min-w-0 truncate text-[length:var(--aries-font-size-base)] text-foreground/85">
                {city.label}
              </span>
              <span className="shrink-0 text-[length:var(--aries-font-size-small)] text-foreground/50">
                {city.countryName}
              </span>
            </button>
          ))}
          {showHeadings ? <div className={headingClass}>{t("placeSearch.addresses")}</div> : null}
          {state.addresses.map((address, j) => {
            const i = cities.length + j;
            return (
              <button
                key={`address-${address.lat}-${address.lon}-${address.name}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick({ kind: "address", address });
                }}
                onMouseEnter={() => setActive(i)}
                className={rowClass(i)}
              >
                <span className="min-w-0 truncate text-[length:var(--aries-font-size-base)] text-foreground/85">
                  {address.name}
                  {address.secondary ? (
                    <span className="ml-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] text-foreground/50">
                      {address.secondary}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[length:var(--aries-font-size-small)] text-foreground/50">
                  {address.countryCode}
                </span>
              </button>
            );
          })}
          {state.addressesPending && rows.length === 0 ? (
            <div className={noteClass}>{t("placeSearch.searching")}</div>
          ) : null}
          {!pending && rows.length === 0 ? <div className={noteClass}>{t("placeSearch.noMatches")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

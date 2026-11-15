/** Compare the named feature itself, independent of its city/state/address type. */
export function normalizePlaceName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isExactPlaceName(query: string, name: string): boolean {
  return normalizePlaceName(query) === normalizePlaceName(name);
}

export function isPlaceNamePrefix(query: string, name: string): boolean {
  return normalizePlaceName(name).startsWith(normalizePlaceName(query));
}

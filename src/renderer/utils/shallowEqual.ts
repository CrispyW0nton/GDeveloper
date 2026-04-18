/**
 * Shallow equality check for plain objects.
 * Returns true if both objects have the same keys with === equal values.
 * Used to prevent unnecessary re-renders / effect re-fires when object
 * references change but values don't (common with spread-based state updates).
 *
 * Sprint 25.9
 */
export function shallowEqual<T extends object>(a: T | null | undefined, b: T | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b) as (keyof T)[];
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

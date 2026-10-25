import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Tells a test the address, path and query, whenever a screen changes it. */
export function AddressListener({ onAddress }: { onAddress: (address: string) => void }) {
  const { pathname, search } = useLocation();
  useEffect(() => onAddress(`${pathname}${search}`), [onAddress, pathname, search]);
  return null;
}

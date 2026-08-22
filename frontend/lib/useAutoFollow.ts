"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The product's claim is that the building assembles itself while the operator
 * keeps talking. A manual panel breaks that: the approach can land, be the most
 * useful thing on the screen, and never be seen.
 *
 * So the newest thing to arrive opens itself — unless the operator has just
 * chosen something, in which case their choice holds. Anything that arrives
 * while they are reading elsewhere is marked instead of stolen.
 */
const OPERATOR_HOLD_MS = 8000;

export function useAutoFollow(
  items: { id: string; ready: boolean }[],
  initialId: string | null = null,
) {
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const lastChoice = useRef(0);

  useEffect(() => {
    const arrived = items.filter((item) => item.ready && !seen.current.has(item.id));
    if (arrived.length === 0) return;

    arrived.forEach((item) => seen.current.add(item.id));
    const operatorIsReading = Date.now() - lastChoice.current < OPERATOR_HOLD_MS;
    const newest = arrived[arrived.length - 1].id;

    if (operatorIsReading) {
      setFresh((current) => new Set([...current, ...arrived.map((item) => item.id)]));
    } else {
      setOpenId(newest);
    }
  }, [items]);

  const choose = (id: string | null) => {
    lastChoice.current = Date.now();
    setOpenId(id);
    if (id) {
      setFresh((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  /** Clears the mark on whatever is open, including auto-opened panels. */
  useEffect(() => {
    if (!openId) return;
    setFresh((current) => {
      if (!current.has(openId)) return current;
      const next = new Set(current);
      next.delete(openId);
      return next;
    });
  }, [openId]);

  return { openId, choose, fresh };
}

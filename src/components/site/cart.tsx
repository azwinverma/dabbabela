"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartItem = {
  key: string;
  kind: "box" | "custom";
  id: string;
  name: string;
  price: number;
  date: string;
  qty: number;
  accent?: string;
  image?: string | null;
  /** chef-approved BoxSubstitution ids chosen for this line */
  subs?: string[];
  /** human label for the swaps, e.g. "Chicken fried rice → Veg fried rice" */
  subsLabel?: string;
};

/** Server payload for quoteCart / placeCartOrder. Prices are always recomputed server-side. */
export function toCartLines(items: CartItem[]) {
  return items.map((i) => ({ kind: i.kind, id: i.id, date: i.date, qty: i.qty, subs: i.subs ?? [] }));
}

type Cart = {
  items: CartItem[];
  count: number;
  subtotal: number;
  ready: boolean;
  add: (item: Omit<CartItem, "key" | "qty"> & { qty?: number }) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  removeWhere: (fn: (i: CartItem) => boolean) => void;
};

const CartCtx = createContext<Cart | null>(null);
const KEY = "dabbabela_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {}
  }, [items, ready]);

  const add: Cart["add"] = useCallback((it) => {
    const key = `${it.kind}:${it.id}:${it.date}:${[...(it.subs ?? [])].sort().join("+")}`;
    setItems((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) return prev.map((p) => (p.key === key ? { ...p, qty: Math.min(20, p.qty + (it.qty ?? 1)) } : p));
      return [...prev, { ...it, key, qty: it.qty ?? 1 }].sort((a, b) => a.date.localeCompare(b.date));
    });
  }, []);

  const value = useMemo<Cart>(
    () => ({
      items,
      ready,
      count: items.reduce((a, b) => a + b.qty, 0),
      subtotal: items.reduce((a, b) => a + b.qty * b.price, 0),
      add,
      setQty: (key, qty) => setItems((p) => (qty <= 0 ? p.filter((i) => i.key !== key) : p.map((i) => (i.key === key ? { ...i, qty: Math.min(20, qty) } : i)))),
      remove: (key) => setItems((p) => p.filter((i) => i.key !== key)),
      clear: () => setItems([]),
      removeWhere: (fn) => setItems((p) => p.filter((i) => !fn(i))),
    }),
    [items, ready, add],
  );

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}

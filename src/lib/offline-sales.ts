import { supabase } from "@/integrations/supabase/client";

export interface PendingSaleItem {
  product_id: string;
  product_code: string;
  product_name: string;
  category: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface PendingSale {
  id: string;
  items: PendingSaleItem[];
  cash: number;
  card: number;
  change: number;
  total: number;
  operator_name: string;
  local_number: number;
  created_at: string;
}

const QUEUE_KEY = "pdv:pending-sales:v1";
const SEQ_KEY = "pdv:last-sale-number:v1";

export const PENDING_EVENT = "pdv:pending-changed";
export const SYNCED_EVENT = "pdv:sales-synced";

function emit(name: string, detail?: unknown) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function getPendingSales(): PendingSale[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingSale[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(list: PendingSale[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  emit(PENDING_EVENT, list.length);
}

export function pendingCount(): number {
  return getPendingSales().length;
}

/** Guarda o último nº de venda conhecido para numerar tickets offline. */
export function rememberSaleNumber(n: number) {
  if (typeof window !== "undefined") localStorage.setItem(SEQ_KEY, String(n));
}

export function nextLocalSaleNumber(): number {
  if (typeof window === "undefined") return 0;
  const last = Number(localStorage.getItem(SEQ_KEY) ?? "-1");
  const next = (Number.isFinite(last) ? last + 1 : 0) % 1000;
  localStorage.setItem(SEQ_KEY, String(next));
  return next;
}

export function enqueueSale(sale: Omit<PendingSale, "id" | "created_at">): PendingSale {
  const entry: PendingSale = {
    ...sale,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  };
  writeQueue([...getPendingSales(), entry]);
  void requestBackgroundSync();
  return entry;
}

export function removePendingSale(id: string) {
  writeQueue(getPendingSales().filter((s) => s.id !== id));
}

/** Erro de rede/conexão (vale a pena tentar de novo mais tarde). */
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("timeout") ||
    msg.includes("fetch")
  );
}

/** Pede Background Sync ao service worker (ignorado silenciosamente se não houver suporte). */
export async function requestBackgroundSync() {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    await reg.sync?.register("pdv-sync-sales");
  } catch {
    // sem suporte: o fallback por listeners/intervalo cobre a sincronização
  }
}

let flushing = false;

export interface FlushResult {
  synced: number;
  remaining: number;
  failed: number;
}

/** Envia as vendas pendentes ao banco, na ordem em que foram feitas. */
export async function flushPendingSales(): Promise<FlushResult> {
  if (flushing) return { synced: 0, remaining: pendingCount(), failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, remaining: pendingCount(), failed: 0 };
  }
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    for (const sale of getPendingSales()) {
      const { data, error } = await supabase.rpc("finalize_sale", {
        _items: sale.items as unknown as never,
        _cash: sale.cash,
        _card: sale.card,
        _change: sale.change,
      });
      if (error) {
        if (isOfflineError(error)) break; // ainda sem conexão: tenta depois
        // erro definitivo (ex.: estoque) — descarta para não travar a fila
        failed += 1;
        removePendingSale(sale.id);
        continue;
      }
      const num = (data as { sale_number?: number } | null)?.sale_number;
      removePendingSale(sale.id);
      synced += 1;
      // só realinha o contador local quando não há mais vendas na fila,
      // para a numeração offline nunca andar para trás
      if (typeof num === "number" && pendingCount() === 0) rememberSaleNumber(num);
    }
  } finally {
    flushing = false;
  }
  const result = { synced, remaining: pendingCount(), failed };
  if (synced > 0 || failed > 0) emit(SYNCED_EVENT, result);
  return result;
}

/* ---------- Último ticket impresso (permite reimprimir offline) ---------- */

const LAST_TICKET_KEY = "pdv:last-ticket:v1";

export function saveLastTicket(sale: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_TICKET_KEY, JSON.stringify(sale));
  } catch {
    // armazenamento cheio: apenas ignora
  }
}

export function loadLastTicket<T>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_TICKET_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

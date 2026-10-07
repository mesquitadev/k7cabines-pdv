import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PENDING_EVENT,
  SYNCED_EVENT,
  flushPendingSales,
  pendingCount,
  requestBackgroundSync,
} from "@/lib/offline-sales";

/**
 * Sincronização automática das vendas feitas offline.
 * Usa Background Sync quando disponível e, como fallback, tenta
 * novamente ao voltar a conexão, ao focar a janela e a cada 30s.
 */
export function PendingSalesSync() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const sync = useCallback(async (manual = false) => {
    setBusy(true);
    const res = await flushPendingSales();
    setBusy(false);
    if (res.synced > 0) {
      toast.success(
        `${res.synced} venda(s) offline sincronizada(s). Estoque e relatórios atualizados.`,
      );
    } else if (manual && res.remaining > 0) {
      toast.error("Ainda sem conexão. Vendas continuam salvas no aparelho.");
    }
    if (res.failed > 0) {
      toast.error(`${res.failed} venda(s) não pôde(puderam) ser registrada(s) no servidor.`);
    }
  }, []);

  useEffect(() => {
    setCount(pendingCount());
    const onPending = () => setCount(pendingCount());
    const onSynced = () => setCount(pendingCount());
    const onOnline = () => {
      setOnline(true);
      void requestBackgroundSync();
      void sync();
    };
    const onOffline = () => setOnline(false);
    const onFocus = () => { if (navigator.onLine) void sync(); };

    window.addEventListener(PENDING_EVENT, onPending);
    window.addEventListener(SYNCED_EVENT, onSynced);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (navigator.onLine && pendingCount() > 0) void sync();
    }, 30_000);

    if (navigator.onLine && pendingCount() > 0) void sync();

    return () => {
      window.removeEventListener(PENDING_EVENT, onPending);
      window.removeEventListener(SYNCED_EVENT, onSynced);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [sync]);

  const statusDot = online ? "bg-green-500" : "bg-yellow-500";
  const StatusIcon = online ? Cloud : CloudOff;
  const statusLabel = online ? "Online" : "Offline";

  return (
    <div className="mx-2 mb-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("relative flex h-2.5 w-2.5", statusDot === "bg-green-500" ? "" : "")}>
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                statusDot,
              )}
            />
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", statusDot)} />
          </span>
          <span className="font-medium">{statusLabel}</span>
        </div>
        <StatusIcon className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="mt-2 text-muted-foreground">
        {count > 0 ? (
          <span className="font-semibold text-foreground">
            {count} venda(s) aguardando envio
          </span>
        ) : online ? (
          "Vendas sincronizadas com o servidor."
        ) : (
          "Vendas salvas no aparelho. Aguardando conexão."
        )}
      </div>

      {(count > 0 || !online) && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2 h-7 w-full text-xs"
          disabled={busy || !online}
          onClick={() => void sync(true)}
        >
          <RefreshCw className={cn("mr-1 h-3 w-3", busy ? "animate-spin" : "")} />
          {busy ? "Sincronizando…" : "Sincronizar agora"}
        </Button>
      )}
    </div>
  );
}


import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { desktop, desktopToken, isDesktop } from "@/lib/desktop";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Product { id: string; name: string; category: string; }
interface Batch { product_id: string; expiry_date: string; quantity: number; }

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const isEroticCategory = (cat: string) => normalize(cat).includes("erotic");
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  return Math.floor((d.getTime() - today.getTime()) / 86400000);
};
const fmtDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

export function ExpiryAlert() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<{ name: string; days: number; date: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    const key = `expiry-alert-shown:${user.id}`;
    if (sessionStorage.getItem(key)) return;
    let cancelled = false;
    (async () => {
      let products: Product[] = [];
      let batches: Batch[] = [];
      if (isDesktop()) {
        const token = desktopToken();
        if (!token) return;
        try {
          const [prods, bats] = await Promise.all([
            desktop.listProducts(token),
            desktop.listBatches(token),
          ]);
          if (cancelled) return;
          products = prods.map((p) => ({ id: p.id, name: p.name, category: p.category }));
          batches = bats.map((b) => ({
            product_id: b.product_id, expiry_date: b.expiry_date, quantity: b.quantity,
          }));
        } catch {
          return;
        }
      }
      const today = todayISO();
      const grouped = new Map<string, Batch[]>();
      for (const b of batches) {
        const arr = grouped.get(b.product_id) ?? [];
        arr.push(b); grouped.set(b.product_id, arr);
      }
      const result: { name: string; days: number; date: string }[] = [];
      for (const p of products) {
        if (!isEroticCategory(p.category)) continue;
        const arr = grouped.get(p.id);
        if (!arr || !arr.length) continue;
        const future = arr.filter(b => b.expiry_date >= today).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
        const chosen = future[0] ?? [...arr].sort((a, b) => b.expiry_date.localeCompare(a.expiry_date))[0];
        if (!chosen) continue;
        const days = daysUntil(chosen.expiry_date);
        if (days <= 45) result.push({ name: p.name, days, date: chosen.expiry_date });
      }
      sessionStorage.setItem(key, "1");
      if (result.length) {
        result.sort((a, b) => a.days - b.days);
        setAlerts(result);
        setOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <AlertTriangle className="h-7 w-7 text-yellow-600" />
            Validade próxima
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto text-lg">
          {alerts.map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border px-3 py-2"
              style={{
                borderColor: a.days < 0 ? "var(--destructive)" : "var(--warning)",
                background:
                  a.days < 0
                    ? "color-mix(in oklab, var(--destructive) 14%, transparent)"
                    : "color-mix(in oklab, var(--warning) 14%, transparent)",
              }}
            >
              <span className="min-w-0 truncate font-medium">{a.name}</span>
              <span
                className="rotulo num shrink-0 whitespace-nowrap text-[11px]"
                style={{ color: a.days < 0 ? "var(--destructive)" : "var(--warning)" }}
              >
                {fmtDate(a.date)} · {a.days < 0 ? "vencido" : `${a.days}d`}
              </span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

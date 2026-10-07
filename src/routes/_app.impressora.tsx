import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Printer, RotateCcw, Save } from "lucide-react";
import { Ticket, type TicketSale } from "@/components/ticket";
import { DEFAULT_TICKET_SETTINGS, fetchTicketSettings, loadTicketSettings, saveTicketSettings, type TicketSettings } from "@/lib/ticket-settings";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_app/impressora")({
  head: () => ({ meta: [{ title: "Impressora — PDV" }] }),
  component: ImpressoraPage,
});

const SAMPLE_SALE: TicketSale = {
  sale_number: 42,
  total: 75.5,
  cash_amount: 50,
  card_amount: 25.5,
  change_amount: 0,
  operator_name: "Clayton",
  created_at: new Date().toISOString(),
  items: [
    { product_code: "001", product_name: "Pulseira K7", unit_price: 30, quantity: 1, subtotal: 30 },
    { product_code: "002", product_name: "Heineken Long Neck", unit_price: 12, quantity: 2, subtotal: 24 },
    { product_code: "003", product_name: "Água C/ Gás", unit_price: 4, quantity: 1, subtotal: 4 },
    { product_code: "004", product_name: "Camisinha", unit_price: 17.5, quantity: 1, subtotal: 17.5 },
  ],
};

function ImpressoraPage() {
  const { role } = useAuth();
  const canSave = role === "gerente" || role === "supervisor";
  const [s, setS] = useState<TicketSettings>(loadTicketSettings());
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchTicketSettings().then(setS).catch(() => setS(loadTicketSettings())); }, []);

  const upd = <K extends keyof TicketSettings>(k: K, v: TicketSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!canSave) { toast.error("Apenas gerente ou supervisor podem salvar"); return; }
    setSaving(true);
    try {
      await saveTicketSettings(s);
      toast.success("Configurações aplicadas a todas as impressões");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!canSave) { toast.error("Apenas gerente ou supervisor podem restaurar"); return; }
    setSaving(true);
    try {
      await saveTicketSettings(DEFAULT_TICKET_SETTINGS);
      setS(DEFAULT_TICKET_SETTINGS);
      toast.success("Padrão restaurado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao restaurar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-background p-4">
        <div>
          <h1 className="text-2xl font-black uppercase flex items-center gap-2"><Printer className="h-6 w-6" /> Impressora</h1>
          <p className="text-xs text-muted-foreground">{canSave ? "Padrão do ticket compartilhado · aplicado a todas as vendas após salvar" : "Somente leitura · apenas gerente/supervisor pode salvar"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={!canSave || saving}><RotateCcw className="h-4 w-4 mr-2" />Restaurar padrão</Button>
          <Button onClick={save} disabled={!canSave || saving}><Save className="h-4 w-4 mr-2" />{saving ? "Salvando…" : "Salvar"}</Button>
        </div>
      </header>

      <div className="grid flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
        {/* Editor */}
        <Card className="p-4 space-y-4">
          <h2 className="text-lg font-bold">Conteúdo</h2>

          <div className="space-y-1.5">
            <Label>Nome da loja (cabeçalho)</Label>
            <Input value={s.store_name} onChange={(e) => upd("store_name", e.target.value)} placeholder="Ex.: Minha Loja" />
            <p className="text-xs text-muted-foreground">Deixe em branco para ocultar.</p>
          </div>

          <p className="text-xs text-muted-foreground">Os demais campos do ticket seguem o padrão do sistema.</p>
        </Card>

        {/* Preview */}
        <div className="space-y-2">
          <h2 className="text-lg font-bold">Pré-visualização</h2>
          <Card className="mx-auto w-full max-w-[320px] bg-white p-3 text-black shadow-md">
            <Ticket sale={SAMPLE_SALE} settings={s} />
          </Card>
          <p className="text-center text-xs text-muted-foreground">Exemplo com venda fictícia</p>
        </div>
      </div>
    </div>
  );
}

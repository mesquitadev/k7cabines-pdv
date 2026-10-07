import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { desktop, isDesktop } from "@/lib/desktop";
import { useAuth, can } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RefreshCcw, Printer, Trash2, Undo2 } from "lucide-react";
import { DrawerDevolucao } from "@/components/drawer-devolucao";
import { imprimirCupom } from "@/lib/impressao";
import { PainelDre } from "@/components/painel-dre";
import type { CashSession, LocalDre } from "@/lib/desktop";
import { Rotulo } from "@/components/placa";
import { AlertTriangle } from "lucide-react";
import { Ticket, type TicketSale } from "@/components/ticket";
import { fetchTicketSettings, loadTicketSettings, type TicketSettings } from "@/lib/ticket-settings";
import { SYNCED_EVENT } from "@/lib/offline-sales";


export const Route = createFileRoute("/_app/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — PDV" }] }),
  component: Relatorios,
});

interface Sale {
  id: string; sale_number: number; operator_name: string; total: number;
  cash_amount: number; card_amount: number; items_count: number; created_at: string;
  discount: number; discount_reason: string; customer_name: string;
}
interface SaleItem { sale_id: string; category: string; subcategory: string; product_name: string; quantity: number; subtotal: number; }
interface StockAddition {
  id: string; product_code: string; product_name: string; category: string;
  quantity: number; operator_name: string; created_at: string;
}
interface DeletedSale {
  id: string; sale_number: number; sale_total: number; sale_created_at: string;
  operator_name: string; deleted_by_name: string; deleted_at: string; reason: string;
}

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};


function buildStockMessage(rows: StockAddition[], from: string, to: string, operator: string) {
  const fmtD = (s: string) => s.split("-").reverse().join("-");
  const totalIn = rows.filter((r) => Number(r.quantity) > 0).reduce((s, r) => s + Number(r.quantity), 0);
  const totalOut = rows.filter((r) => Number(r.quantity) < 0).reduce((s, r) => s + Number(r.quantity), 0);
  const lines: string[] = [];
  lines.push(`*Alterações no Estoque*`);
  lines.push(`Período: ${fmtD(from)} a ${fmtD(to)}`);
  if (operator) lines.push(`Colaborador: ${operator}`);
  lines.push("");
  rows.forEach((r) => {
    const q = Number(r.quantity);
    const tipo = q < 0 ? "Exclusão" : "Inclusão";
    const qtd = `${q < 0 ? "" : "+"}${q.toLocaleString("pt-BR")}`;
    lines.push(`- ${fmtTime(r.created_at)} · ${r.product_name} · ${r.operator_name || "-"} · ${tipo} · ${qtd}`);
  });
  lines.push("");
  lines.push(`*Movimentações:* ${rows.length}`);
  lines.push(`Inclusões: +${totalIn.toLocaleString("pt-BR")} · Exclusões: ${totalOut.toLocaleString("pt-BR")}`);
  return lines.join("\n");
}


export default function Relatorios() {
  const { profile, role, session, pode } = useAuth();
  const localToken = session && "token" in session ? session.token : null;
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [to, setTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [additions, setAdditions] = useState<StockAddition[]>([]);
  const [deletedSales, setDeletedSales] = useState<DeletedSale[]>([]);
  
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [dre, setDre] = useState<LocalDre | null>(null);
  const [turnos, setTurnos] = useState<CashSession[]>([]);
  const [devolucaoAlvo, setDevolucaoAlvo] = useState<{ id: string; sale_number: number; total_cents: number } | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Limite de histórico vem do perfil (Configurações › Usuários › Perfil).
  // Vazio = sem limite. O Rust recusa consulta fora do limite de qualquer jeito.
  const [minDate, setMinDate] = useState<string | null>(null);
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  useEffect(() => {
    if (!localToken) return;
    desktop.reportEarliestDate(localToken).then(setMinDate).catch(() => setMinDate(null));
  }, [localToken]);

  // resetar para o dia vigente ao montar o componente
  useEffect(() => {
    setFrom(todayStr);
    setTo(todayStr);
  }, [todayStr]);

  // Clamp das datas ao limite do perfil — sem loop
  useEffect(() => {
    if (minDate === null) return;
    setFrom((f) => (f < minDate ? minDate : f));
    setTo((t) => (t > todayStr ? todayStr : t));
  }, [minDate, todayStr]);

  // Apenas gerente pode excluir vendas de dias anteriores
  const canDeleteSale = (sale: Sale) => {
    if (role === "gerente" || role === "master") return true;
    const d = new Date(sale.created_at);
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return local === todayStr;
  };

  /** Reimprimir é um comando: o Rust relê a venda do banco e monta os bytes. */
  const handleReprint = (sale: Sale) => imprimirCupom(sale.id);

  const openDelete = (sale: Sale) => {
    setDeleteTarget(sale);
    setDeleteReason("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const reason = deleteReason.trim();
    if (reason.length < 3) return toast.error("Informe o motivo (mín. 3 caracteres)");
    if (!localToken) return toast.error("Sessão local expirada. Entre novamente.");
    setDeleting(true);
    try {
      await desktop.deleteSale(localToken, { sale_id: deleteTarget.id, reason });
    } catch (e) {
      return toast.error(typeof e === "string" ? e : "Não foi possível excluir a venda");
    } finally {
      setDeleting(false);
    }
    toast.success(`Venda #${deleteTarget.sale_number} excluída`);
    setDeleteTarget(null);
    setDeleteReason("");
    load();
  };



  // Desktop: tudo vem do SQLite local, via comandos Rust.
  const loadLocal = async () => {
    if (!localToken) return;
    const range = { from, to };
    const reais = (centavos: number) => centavos / 100;
    const [vendas, itens, movimentos, excluidas, resultado, sessoes] = await Promise.all([
      desktop.reportSales(localToken, range).catch(() => []),
      desktop.reportItems(localToken, range).catch(() => []),
      desktop.reportMovements(localToken, range).catch(() => []),
      desktop.reportDeletedSales(localToken, range).catch(() => []),
      pode("reports.result") ? desktop.reportDre(localToken, range).catch(() => null) : Promise.resolve(null),
      desktop.listCashSessions(localToken, range).catch(() => []),
    ]);
    setDre(resultado);
    setTurnos(sessoes);
    setSales(vendas.map((v) => ({
      id: v.id, sale_number: v.sale_number, operator_name: v.operator_name,
      total: reais(v.total_cents), cash_amount: reais(v.cash_cents),
      card_amount: reais(v.card_cents), items_count: v.items_count, created_at: v.created_at,
      discount: reais(v.discount_cents ?? 0), discount_reason: v.discount_reason ?? "",
      customer_name: v.customer_name ?? "",
    })));
    setItems(itens.map((i) => ({
      sale_id: i.sale_id, category: i.category, subcategory: i.subcategory ?? "", product_name: i.product_name, quantity: i.quantity, subtotal: reais(i.subtotal_cents),
    })));
    setAdditions(movimentos.filter((m) => m.delta > 0).map((m) => ({
      id: m.id, product_code: "", product_name: m.product_name, category: m.reason,
      quantity: m.delta, operator_name: m.actor_name, created_at: m.occurred_at,
    })));
    setDeletedSales(excluidas.map((d, idx) => ({
      id: `${d.sale_number}-${idx}`, sale_number: d.sale_number, sale_total: reais(d.total_cents),
      sale_created_at: d.deleted_at, operator_name: d.operator_name,
      deleted_by_name: d.deleted_by_name, deleted_at: d.deleted_at, reason: d.reason,
    })));
  };

  const load = loadLocal;

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  // Recarrega relatórios quando vendas offline são sincronizadas
  useEffect(() => {
    if (isDesktop()) return;
    const onSynced = () => { load(); };
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
    /* eslint-disable-next-line */
  }, [from, to]);

  const summary = useMemo(() => {
    const total = sales.reduce((s, x) => s + Number(x.total), 0);
    const cash = sales.reduce((s, x) => s + Number(x.cash_amount), 0);
    const card = sales.reduce((s, x) => s + Number(x.card_amount), 0);
    const byCat = new Map<string, { qty: number; value: number }>();
    // Subcategorias agrupadas dentro de cada categoria (ex.: Bebidas › Heineken).
    const bySub = new Map<string, Map<string, { qty: number; value: number }>>();
    items.forEach((i) => {
      const cur = byCat.get(i.category) ?? { qty: 0, value: 0 };
      cur.qty += Number(i.quantity); cur.value += Number(i.subtotal);
      byCat.set(i.category, cur);
      const sub = (i.subcategory ?? "").trim();
      if (sub) {
        const subs = bySub.get(i.category) ?? new Map<string, { qty: number; value: number }>();
        const cs = subs.get(sub) ?? { qty: 0, value: 0 };
        cs.qty += Number(i.quantity); cs.value += Number(i.subtotal);
        subs.set(sub, cs);
        bySub.set(i.category, subs);
      }
    });
    const subsOf = (cat: string) =>
      Array.from((bySub.get(cat) ?? new Map()).entries()).sort(([a], [b]) => a.localeCompare(b));
    return { total, cash, card, count: sales.length, byCat: Array.from(byCat.entries()), subsOf };
  }, [sales, items]);

  const buildMessage = () => {
    const formatDate = (dateStr: string) => dateStr.split("-").reverse().join("-");
    const lines: string[] = [];
    lines.push(`*Fechamento de Caixa*`);
    lines.push(`Período: ${formatDate(from)} a ${formatDate(to)}`);
    lines.push(`Operador: ${profile?.full_name ?? "-"}`);
    lines.push("");
    lines.push(`*Total: ${fmt(summary.total)}*`);
    lines.push(`Dinheiro: ${fmt(summary.cash)}`);
    lines.push(`Maquininha: ${fmt(summary.card)}`);
    lines.push(`Vendas: ${summary.count}`);
    lines.push("");
    lines.push(`*Por categoria*`);
    const sortedByCat = [...summary.byCat].sort(([a], [b]) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aPulseira = aLower.includes("pulseira");
      const bPulseira = bLower.includes("pulseira");
      const aErotico = aLower.includes("produtos eróticos");
      const bErotico = bLower.includes("produtos eróticos");
      
      if (aPulseira && !bPulseira) return -1;
      if (bPulseira && !aPulseira) return 1;
      if (aErotico && !bErotico) return 1;
      if (bErotico && !aErotico) return -1;
      
      return aLower.localeCompare(bLower);
    });
    sortedByCat.forEach(([cat, v]) => {
      lines.push(`- ${cat}: ${v.qty.toLocaleString("pt-BR")} un · ${fmt(v.value)}`);
      summary.subsOf(cat).forEach(([sub, sv]) => {
        lines.push(`   › ${sub}: ${sv.qty.toLocaleString("pt-BR")} un · ${fmt(sv.value)}`);
      });
    });
    const comDesconto = sales.filter((s) => s.discount > 0);
    if (comDesconto.length) {
      lines.push("");
      lines.push(`*Descontos concedidos: ${comDesconto.length}*`);
      comDesconto.forEach((s) => {
        const produtos = items
          .filter((i) => i.sale_id === s.id)
          .map((i) => `${i.quantity}× ${i.product_name}`)
          .join(", ");
        lines.push(`- #${String(s.sale_number).padStart(5, "0")} · desconto ${fmt(s.discount)}`);
        lines.push(`   usuário: ${s.operator_name} · cliente: ${s.customer_name || "-"}`);
        lines.push(`   produto: ${produtos || "-"}`);
        lines.push(`   motivo: ${s.discount_reason || "-"}`);
      });
    }
    lines.push("");
    lines.push(`*Vendas excluídas: ${deletedSales.length}*`);
    if (deletedSales.length) {
      const totalExcl = deletedSales.reduce((s, d) => s + Number(d.sale_total), 0);
      lines.push(`Valor total excluído: ${fmt(totalExcl)}`);
      deletedSales.forEach((d) => {
        lines.push(`- #${String(d.sale_number).padStart(5, "0")} · ${fmt(Number(d.sale_total))} · excluída por ${d.deleted_by_name || "-"} · ${fmtTime(d.deleted_at)} · motivo: ${d.reason || "-"}`);
      });
    }
    return lines.join("\n");
  };


  return (
    <div className="h-full min-h-0 overflow-y-auto p-6 pb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black uppercase">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Fechamento e movimento de caixa</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label>De</Label><Input type="date" value={from} min={minDate ?? undefined} max={todayStr} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>Até</Label><Input type="date" value={to} min={minDate ?? undefined} max={todayStr} onChange={(e) => setTo(e.target.value)} /></div>
          {minDate && (
            <p className="basis-full text-xs text-muted-foreground">
              Seu perfil consulta a partir de {minDate.split("-").reverse().join("/")}.
            </p>
          )}
          <Button variant="outline" onClick={load}><RefreshCcw className="mr-2 h-4 w-4" />Atualizar</Button>
        </div>
      </div>

      {/* Totais do período: só para quem tem "Resultado financeiro". */}
      {pode("reports.result") && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total" value={fmt(summary.total)} highlight />
          <Stat label="Dinheiro" value={fmt(summary.cash)} />
          <Stat label="Maquininha" value={fmt(summary.card)} />
          <Stat label="Vendas" value={String(summary.count)} />
        </div>
      )}

      {(() => {
        const isManager = role === "gerente" || role === "master";
        const podeResultado = pode("reports.result");
        const subAcc = {
          vendas: isManager || (profile?.access_rel_vendas ?? true),
          hora: isManager || (profile?.access_rel_hora ?? true),
          categorias: isManager || (profile?.access_rel_categorias ?? true),
          estoque: isManager || (profile?.access_rel_estoque ?? true),
          fechamento: isManager || (profile?.access_rel_fechamento ?? true),
        };
        // O resultado abre primeiro: é a pergunta que o dono faz ao abrir a
        // tela, e a lista de vendas é o detalhamento dela, não o contrário.
        const firstTab = podeResultado
          ? "resultado"
          : subAcc.vendas ? "vendas"
          : subAcc.hora ? "hora"
          : subAcc.categorias ? "categorias"
          : subAcc.estoque && pode("reports.stock") ? "adicionados"
          : "whatsapp";
        return (
      <Tabs defaultValue={firstTab}>
        <TabsList>
          {podeResultado && <TabsTrigger value="resultado">Resultado</TabsTrigger>}
          {subAcc.vendas && <TabsTrigger value="vendas">Vendas</TabsTrigger>}
          {subAcc.hora && <TabsTrigger value="hora">Hora em hora</TabsTrigger>}
          {subAcc.categorias && <TabsTrigger value="categorias">Por categoria</TabsTrigger>}
          {subAcc.estoque && pode("reports.stock") && (
            <TabsTrigger value="adicionados">Alterações no estoque</TabsTrigger>
          )}
          {subAcc.fechamento && <TabsTrigger value="whatsapp">Fechamento</TabsTrigger>}
        </TabsList>
        {podeResultado && (
        <TabsContent value="resultado">
          {dre ? (
            <PainelDre dre={dre} mostrarLucro={role === "gerente" || role === "master"} />
          ) : (
            <div className="placa p-12 text-center text-sm text-muted-foreground">
              Carregando o resultado do período…
            </div>
          )}
        </TabsContent>
        )}

        <TabsContent value="vendas">
          <Card>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nº</TableHead><TableHead>Data</TableHead><TableHead>Operador</TableHead><TableHead className="text-right">Itens</TableHead><TableHead className="text-right">Dinheiro</TableHead><TableHead className="text-right">Maquininha</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => {
                  const hour = new Date(s.created_at).getHours();
                  const rowBg = hour % 2 === 1 ? "bg-muted/60" : "bg-background";
                  return (
                  <TableRow key={s.id} className={rowBg}>
                    <TableCell className="font-black text-primary">#{String(s.sale_number).padStart(5, "0")}</TableCell>
                    <TableCell>{fmtDate(s.created_at)}</TableCell>
                    <TableCell>{s.operator_name}</TableCell>
                    <TableCell className="text-right">{s.items_count}</TableCell>
                    <TableCell className="text-right">{fmt(Number(s.cash_amount))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(s.card_amount))}</TableCell>
                    <TableCell className="text-right font-bold">{fmt(Number(s.total))}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => handleReprint(s)}>
                          <Printer className="mr-1 h-3 w-3" /> Reimprimir
                        </Button>
                        {pode("sale.return") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDevolucaoAlvo({
                                id: s.id,
                                sale_number: s.sale_number,
                                total_cents: Math.round(Number(s.total) * 100),
                              })
                            }
                            title={canDeleteSale(s) ? "Devolver item desta venda" : "Apenas vendas do dia vigente podem ser devolvidas"}
                            disabled={!canDeleteSale(s)}
                          >
                            <Undo2 className="mr-1 h-3 w-3" /> Devolver
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="acao-destrutiva" onClick={() => openDelete(s)} title={canDeleteSale(s) ? "Excluir venda" : "Apenas vendas do dia vigente podem ser excluídas"} disabled={!canDeleteSale(s)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {!sales.length && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Sem vendas no período</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="hora">
          {(() => {
            const now = new Date();
            const currentHour = now.getHours();
            const currentDay = now.toDateString();
            const prevDate = new Date(now.getTime() - 60 * 60 * 1000);
            const prevHour = prevDate.getHours();
            const prevDay = prevDate.toDateString();

            const computeStats = (day: string, hour: number) => {
              const list = sales.filter((s) => {
                const d = new Date(s.created_at);
                return d.toDateString() === day && d.getHours() === hour;
              });
              const ids = new Set(list.map((s) => s.id));
              const itens = list.reduce((a, s) => a + Number(s.items_count), 0);
              const pulseiras = items
                .filter((i) => ids.has(i.sale_id) && i.category.toLowerCase().includes("pulseira"))
                .reduce((a, i) => a + Number(i.quantity), 0);
              const bebidas = items
                .filter((i) => {
                  if (!ids.has(i.sale_id)) return false;
                  const c = i.category.toLowerCase();
                  return !c.includes("pulseira") && !c.includes("produtos eróticos");
                })
                .reduce((a, i) => a + Number(i.quantity), 0);
              const eroticos = items
                .filter((i) => ids.has(i.sale_id) && i.category.toLowerCase().includes("produtos eróticos"))
                .reduce((a, i) => a + Number(i.quantity), 0);
              return { list, itens, pulseiras, bebidas, eroticos };
            };

            const cur = computeStats(currentDay, currentHour);
            const prev = computeStats(prevDay, prevHour);
            return (
              <Card>
                <div className="grid gap-3 p-4 sm:grid-cols-4">
                  <Stat label="Horário" value={`${String(currentHour).padStart(2, "0")}:00 - ${String(currentHour).padStart(2, "0")}:59`} />
                  <Stat label="Pulseiras / Itens" value={`${cur.pulseiras} / ${cur.itens}`} />
                  <Stat label="Bebidas / Itens" value={`${cur.bebidas} / ${cur.itens}`} />
                  <Stat label="Produtos Eróticos / Itens" value={`${cur.eroticos} / ${cur.itens}`} />
                </div>
                <div className="grid gap-3 px-4 pb-4 sm:grid-cols-4">
                  <Stat label="Horário anterior" value={`${String(prevHour).padStart(2, "0")}:00 - ${String(prevHour).padStart(2, "0")}:59`} />
                  <Stat label="Pulseiras / Itens" value={`${prev.pulseiras} / ${prev.itens}`} highlight />
                  <Stat label="Bebidas / Itens" value={`${prev.bebidas} / ${prev.itens}`} highlight />
                  <Stat label="Produtos Eróticos / Itens" value={`${prev.eroticos} / ${prev.itens}`} highlight />
                </div>
              </Card>
            );
          })()}

        </TabsContent>
        <TabsContent value="categorias">
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Categoria</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {[...summary.byCat].sort(([a], [b]) => {
                  const aLower = a.toLowerCase();
                  const bLower = b.toLowerCase();
                  const aPulseira = aLower.includes("pulseira");
                  const bPulseira = bLower.includes("pulseira");
                  const aErotico = aLower.includes("produtos eróticos");
                  const bErotico = bLower.includes("produtos eróticos");
                  if (aPulseira && !bPulseira) return -1;
                  if (bPulseira && !aPulseira) return 1;
                  if (aErotico && !bErotico) return 1;
                  if (bErotico && !aErotico) return -1;
                  return aLower.localeCompare(bLower);
                }).flatMap(([cat, v]) => [
                  <TableRow key={cat}><TableCell><Badge variant="secondary">{cat}</Badge></TableCell><TableCell className="text-right">{v.qty.toLocaleString("pt-BR")}</TableCell><TableCell className="text-right font-bold">{fmt(v.value)}</TableCell></TableRow>,
                  ...summary.subsOf(cat).map(([sub, sv]) => (
                    <TableRow key={`${cat}›${sub}`}><TableCell className="pl-10 text-muted-foreground">› {sub}</TableCell><TableCell className="text-right">{sv.qty.toLocaleString("pt-BR")}</TableCell><TableCell className="text-right">{fmt(sv.value)}</TableCell></TableRow>
                  )),
                ])}
                {!summary.byCat.length && <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">—</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        {pode("reports.stock") && (
          <TabsContent value="adicionados">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {additions.map((a) => {
                    const qty = Number(a.quantity);
                    const isRemoval = qty < 0;
                    return (
                      <TableRow key={a.id}>
                        <TableCell>{fmtDate(a.created_at)}</TableCell>
                        <TableCell className="font-mono">{a.product_code}</TableCell>
                        <TableCell className="font-semibold">{a.product_name}</TableCell>
                        <TableCell><Badge variant="secondary">{a.category}</Badge></TableCell>
                        <TableCell>{a.operator_name}</TableCell>
                        <TableCell>
                          {isRemoval
                            ? <Badge variant="destructive">Exclusão</Badge>
                            : <Badge className="bg-success text-success-foreground">Inclusão</Badge>}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${isRemoval ? "text-destructive" : "text-success"}`}>
                          {isRemoval ? "" : "+"}{qty.toLocaleString("pt-BR")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!additions.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhuma alteração de estoque no período</TableCell></TableRow>}
                </TableBody>
              </Table>
              {additions.length > 0 && (
                <div className="p-3">
                  <Label>Pré-visualização</Label>
                  <pre className="rounded-lg bg-secondary p-3 text-sm whitespace-pre-wrap">{buildStockMessage(additions, from, to, profile?.full_name ?? "")}</pre>
                </div>
              )}
            </Card>
          </TabsContent>
        )}
        <TabsContent value="whatsapp">
          {/* Histórico de turnos: onde a virada de dia sem contagem aparece. */}
          <div className="painel mb-4 overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <Rotulo>Turnos do período</Rotulo>
            </div>
            {turnos.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhum turno aberto no período.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {turnos.map((t) => {
                  const semContagem = t.closed_without_count;
                  const diferenca = t.difference_cents;
                  return (
                    <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                      <div className="min-w-[12rem] flex-1">
                        <div className="num text-sm">
                          {new Date(t.opened_at).toLocaleDateString("pt-BR")} ·{" "}
                          {new Date(t.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          {t.closed_at &&
                            ` → ${new Date(t.closed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                        </div>
                        <div className="rotulo text-[10px] text-muted-foreground">
                          Abriu {t.opened_by_name}
                          {t.closed_by_name && ` · Fechou ${t.closed_by_name}`}
                          {t.notes && ` · ${t.notes}`}
                        </div>
                      </div>
                      <div className="num text-right text-xs text-muted-foreground">
                        esperado {fmt((t.expected_cash_cents ?? 0) / 100)}
                      </div>
                      <div className="min-w-[10rem] text-right">
                        {t.status === "aberta" ? (
                          <span className="rotulo text-[11px]" style={{ color: "var(--success)" }}>
                            em aberto
                          </span>
                        ) : semContagem ? (
                          <span
                            className="rotulo inline-flex items-center gap-1 text-[11px]"
                            style={{ color: "var(--warning)" }}
                            title="Encerrado na virada de dia: ninguém contou a gaveta, então não há diferença apurada."
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden /> sem conferência
                          </span>
                        ) : (
                          <span
                            className="num text-sm"
                            style={{
                              color:
                                (diferenca ?? 0) === 0
                                  ? "var(--success)"
                                  : "var(--destructive)",
                            }}
                          >
                            {(diferenca ?? 0) === 0
                              ? "conferido, sem diferença"
                              : `${(diferenca ?? 0) > 0 ? "sobra" : "falta"} ${fmt(Math.abs(diferenca ?? 0) / 100)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Card className="space-y-3 p-4">
            <div>
              <Label>Vendas excluídas no período</Label>
              {deletedSales.length === 0 ? (
                <p className="mt-1 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Nenhuma venda excluída.</p>
              ) : (
                <div className="mt-1 rounded-lg border bg-secondary/40 p-3 text-sm">
                  <p className="mb-2 font-semibold text-destructive">
                    {deletedSales.length} venda(s) excluída(s) · {fmt(deletedSales.reduce((s, d) => s + Number(d.sale_total), 0))}
                  </p>
                  <ul className="space-y-1">
                    {deletedSales.map((d) => (
                      <li key={d.id}>
                        #{String(d.sale_number).padStart(5, "0")} · {fmt(Number(d.sale_total))} · excluída por <b>{d.deleted_by_name || "-"}</b> em {fmtDate(d.deleted_at)} · motivo: <i>{d.reason || "-"}</i>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <Label>Pré-visualização</Label>
              <pre className="rounded-lg bg-secondary p-3 text-sm whitespace-pre-wrap">{buildMessage()}</pre>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
        );
      })()}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir venda {deleteTarget && `#${String(deleteTarget.sale_number).padStart(5, "0")}`}</DialogTitle>
            <DialogDescription>
              {deleteTarget && `Valor ${fmt(Number(deleteTarget.total))}. O estoque será devolvido e a exclusão registrada no fechamento.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo da exclusão (obrigatório)</Label>
            <Textarea
              id="reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Descreva por extenso o motivo da exclusão"
              rows={3}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting || deleteReason.trim().length < 3}>
              {deleting ? "Excluindo..." : "Confirmar exclusão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DrawerDevolucao
        venda={devolucaoAlvo}
        onFechar={() => setDevolucaoAlvo(null)}
        onDevolvido={load}
      />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={`p-4 ${highlight ? "border-2 border-primary bg-primary text-primary-foreground" : ""}`}>
      <div className="text-xs uppercase opacity-80">{label}</div>
      <div className="text-2xl font-black">{value}</div>
    </Card>
  );
}

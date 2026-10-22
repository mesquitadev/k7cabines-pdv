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
import { toast } from "sonner";
import { RefreshCcw, Printer, Undo2, CalendarDays } from "lucide-react";
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
/** Item alterado (removido de um pedido) no período. */
interface AlteredItem {
  id: string; sale_number: number; product_name: string; quantity: number; amount: number;
  refund_kind: string; actor_name: string; reason: string; occurred_at: string;
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
/** Dia local (aaaa-mm-dd) de um instante: o relatório agrupa pelo dia da loja, não UTC. */
const diaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Pulseiras primeiro, eróticos por último, o resto em ordem alfabética: é como a loja lê. */
const ordemCategorias = (a: string, b: string) => {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const ap = al.includes("pulseira");
  const bp = bl.includes("pulseira");
  if (ap !== bp) return ap ? -1 : 1;
  const ae = al.includes("erótico");
  const be = bl.includes("erótico");
  if (ae !== be) return ae ? 1 : -1;
  return al.localeCompare(bl);
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
  const [alteredItems, setAlteredItems] = useState<AlteredItem[]>([]);

  const [dre, setDre] = useState<LocalDre | null>(null);
  const [turnos, setTurnos] = useState<CashSession[]>([]);
  /* Fichas pagas e não retiradas, pendências retiradas e não pagas: em aberto agora. */
  const [emAberto, setEmAberto] = useState({ fichas: 0, pendencias: 0, pendenteCents: 0 });
  const [devolucaoAlvo, setDevolucaoAlvo] = useState<{ id: string; sale_number: number; total_cents: number } | null>(null);

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

  // Apenas gerente/master pode alterar vendas de dias anteriores
  const canAlterSale = (sale: Sale) => {
    if (role === "gerente" || role === "master") return true;
    const d = new Date(sale.created_at);
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return local === todayStr;
  };

  /** Reimprimir é um comando: o Rust relê a venda do banco e monta os bytes. */
  const handleReprint = (sale: Sale) => imprimirCupom(sale.id);

  // Desktop: tudo vem do SQLite local, via comandos Rust.
  const loadLocal = async () => {
    if (!localToken) return;
    const range = { from, to };
    const reais = (centavos: number) => centavos / 100;
    const [vendas, itens, movimentos, alteracoes, resultado, sessoes, fichas] = await Promise.all([
      desktop.reportSales(localToken, range).catch(() => []),
      desktop.reportItems(localToken, range).catch(() => []),
      desktop.reportMovements(localToken, range).catch(() => []),
      desktop.reportReturns(localToken, range).catch(() => []),
      pode("reports.result") ? desktop.reportDre(localToken, range).catch(() => null) : Promise.resolve(null),
      desktop.listCashSessions(localToken, range).catch(() => []),
      desktop.listCreditVouchers(localToken).catch(() => []),
    ]);
    setDre(resultado);
    setTurnos(sessoes);
    setEmAberto({
      fichas: fichas.filter((f) => f.kind !== "pendencia").length,
      pendencias: fichas.filter((f) => f.kind === "pendencia").length,
      pendenteCents: fichas
        .filter((f) => f.kind === "pendencia")
        .reduce((soma, f) => soma + (f.pending_cents ?? 0), 0),
    });
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
    setAlteredItems(alteracoes.map((a, idx) => ({
      id: `${a.sale_number}-${idx}`, sale_number: a.sale_number, product_name: a.product_name,
      quantity: a.quantity, amount: reais(a.amount_cents), refund_kind: a.refund_kind,
      actor_name: a.actor_name, reason: a.reason, occurred_at: a.occurred_at,
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

  /**
   * Diário de vendas: a planilha de papel da loja, uma linha por dia do
   * período. Hoje o funcionário anota à mão total, dinheiro, maquininha,
   * quantas pulseiras e bebidas saíram e quantos tickets foram alterados;
   * aqui o sistema preenche a partir das vendas gravadas.
   */
  const diario = useMemo(() => {
    type Cat = { qty: number; value: number; subs: Map<string, number> };
    type Dia = { total: number; cash: number; card: number; count: number; cats: Map<string, Cat>; alteracoes: number };
    const dias = new Map<string, Dia>();
    const novo = (): Dia => ({ total: 0, cash: 0, card: 0, count: 0, cats: new Map(), alteracoes: 0 });
    const diaDaVenda = new Map<string, string>();
    sales.forEach((s) => {
      const k = diaLocal(s.created_at);
      diaDaVenda.set(s.id, k);
      const d = dias.get(k) ?? novo();
      d.total += Number(s.total); d.cash += Number(s.cash_amount); d.card += Number(s.card_amount); d.count += 1;
      dias.set(k, d);
    });
    const categorias = new Set<string>();
    items.forEach((i) => {
      const k = diaDaVenda.get(i.sale_id);
      if (!k) return;
      const d = dias.get(k) ?? novo();
      const c = d.cats.get(i.category) ?? { qty: 0, value: 0, subs: new Map<string, number>() };
      c.qty += Number(i.quantity); c.value += Number(i.subtotal);
      const sub = (i.subcategory ?? "").trim();
      if (sub) c.subs.set(sub, (c.subs.get(sub) ?? 0) + Number(i.quantity));
      d.cats.set(i.category, c);
      dias.set(k, d);
      categorias.add(i.category);
    });
    alteredItems.forEach((a) => {
      const k = diaLocal(a.occurred_at);
      const d = dias.get(k) ?? novo();
      d.alteracoes += 1;
      dias.set(k, d);
    });
    const colunas = [...categorias].sort(ordemCategorias);
    const linhas = [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, d]) => ({ dia, ...d }));
    const soma = linhas.reduce(
      (t, l) => {
        t.total += l.total; t.cash += l.cash; t.card += l.card; t.count += l.count; t.alteracoes += l.alteracoes;
        l.cats.forEach((c, cat) => {
          const cur = t.cats.get(cat) ?? { qty: 0, value: 0, subs: new Map<string, number>() };
          cur.qty += c.qty; cur.value += c.value;
          t.cats.set(cat, cur);
        });
        return t;
      },
      novo(),
    );
    return { colunas, linhas, soma };
  }, [sales, items, alteredItems]);

  /** Atalho da planilha mensal: do dia 1 até hoje. */
  const esteMes = () => {
    const d = new Date();
    const inicio = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    setFrom(minDate && inicio < minDate ? minDate : inicio);
    setTo(todayStr);
  };

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
    lines.push(`*Fichas em aberto: ${emAberto.fichas}* (pagas e não retiradas)`);
    lines.push(
      `*Pendências em aberto: ${emAberto.pendencias}${emAberto.pendencias ? ` · ${fmt(emAberto.pendenteCents / 100)}` : ""}* (retiradas e não pagas)`,
    );
    lines.push("");
    lines.push(`*Itens alterados: ${alteredItems.length}*`);
    if (alteredItems.length) {
      const totalAlt = alteredItems.reduce((s, a) => s + Number(a.amount), 0);
      lines.push(`Valor retirado dos pedidos: ${fmt(totalAlt)}`);
      alteredItems.forEach((a) => {
        lines.push(`- #${String(a.sale_number).padStart(5, "0")} · ${a.quantity}× ${a.product_name} · ${fmt(Number(a.amount))} · ${a.actor_name || "-"} · ${fmtTime(a.occurred_at)} · motivo: ${a.reason || "-"}`);
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
          <Button variant="outline" onClick={esteMes}><CalendarDays className="mr-2 h-4 w-4" />Este mês</Button>
          <Button variant="outline" onClick={load}><RefreshCcw className="mr-2 h-4 w-4" />Atualizar</Button>
        </div>
      </div>

      {/* Totais do período: só para quem tem "Resultado financeiro". */}
      {/* O geral do período é de quem opera; só o lucro (aba Resultado) é restrito. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total" value={fmt(summary.total)} highlight />
        <Stat label="Dinheiro" value={fmt(summary.cash)} />
        <Stat label="Maquininha" value={fmt(summary.card)} />
        <Stat label="Vendas" value={String(summary.count)} />
      </div>

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
          {podeResultado && <TabsTrigger value="diario">Diário de vendas</TabsTrigger>}
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
                            title={canAlterSale(s) ? "Alterar este pedido: remover unidades com motivo" : "Apenas vendas do dia vigente podem ser alteradas"}
                            disabled={!canAlterSale(s)}
                          >
                            <Undo2 className="mr-1 h-3 w-3" /> Alterar
                          </Button>
                        )}
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
            // Total do período filtrado: o que a foto do hora em hora não mostra sozinha.
            const totalItens = sales.reduce((a, s) => a + Number(s.items_count), 0);
            const totalValor = sales.reduce((a, s) => a + Number(s.total), 0);
            const totalPulseiras = items
              .filter((i) => i.category.toLowerCase().includes("pulseira"))
              .reduce((a, i) => a + Number(i.quantity), 0);
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
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
                  <span className="rotulo">Total até agora · {from === to ? "hoje" : "período"}</span>
                  <span className="num">
                    {sales.length} venda(s) · {totalItens} item(ns) · {totalPulseiras} pulseira(s) · {fmt(totalValor)}
                  </span>
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
        {podeResultado && (
        <TabsContent value="diario">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <p className="font-semibold">Diário de vendas</p>
                <p className="text-xs text-muted-foreground">
                  Uma linha por dia do período. Em cada categoria: quantidade vendida, valor e subcategorias. Use "Este mês" para a planilha mensal.
                </p>
              </div>
              <span className="num text-xs text-muted-foreground">{diario.linhas.length} dia(s) com venda</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Dinheiro</TableHead>
                    <TableHead className="text-right">Maquininha</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    {diario.colunas.map((cat) => (
                      <TableHead key={cat} className="text-right">{cat}</TableHead>
                    ))}
                    <TableHead className="text-right">Alterações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diario.linhas.map((l) => (
                    <TableRow key={l.dia}>
                      <TableCell className="num font-semibold whitespace-nowrap">{l.dia.split("-").reverse().join("/")}</TableCell>
                      <TableCell className="num text-right font-bold">{fmt(l.total)}</TableCell>
                      <TableCell className="num text-right">{fmt(l.cash)}</TableCell>
                      <TableCell className="num text-right">{fmt(l.card)}</TableCell>
                      <TableCell className="num text-right">{l.count}</TableCell>
                      {diario.colunas.map((cat) => {
                        const c = l.cats.get(cat);
                        if (!c) return <TableCell key={cat} className="text-right text-muted-foreground">—</TableCell>;
                        const subs = [...c.subs.entries()].sort(([a], [b]) => a.localeCompare(b));
                        return (
                          <TableCell key={cat} className="text-right align-top">
                            <span className="num text-base font-bold">{c.qty.toLocaleString("pt-BR")}</span>
                            <span className="num block text-xs text-muted-foreground">{fmt(c.value)}</span>
                            {subs.length > 0 && (
                              <span className="block text-[11px] text-muted-foreground">
                                {subs.map(([s, q]) => `${s} ${q.toLocaleString("pt-BR")}`).join(" · ")}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className={`num text-right ${l.alteracoes ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{l.alteracoes}</TableCell>
                    </TableRow>
                  ))}
                  {!diario.linhas.length && (
                    <TableRow><TableCell colSpan={6 + diario.colunas.length} className="py-10 text-center text-muted-foreground">Nenhuma venda no período.</TableCell></TableRow>
                  )}
                  {diario.linhas.length > 1 && (
                    <TableRow className="bg-secondary/60 font-bold">
                      <TableCell>Total do período</TableCell>
                      <TableCell className="num text-right">{fmt(diario.soma.total)}</TableCell>
                      <TableCell className="num text-right">{fmt(diario.soma.cash)}</TableCell>
                      <TableCell className="num text-right">{fmt(diario.soma.card)}</TableCell>
                      <TableCell className="num text-right">{diario.soma.count}</TableCell>
                      {diario.colunas.map((cat) => {
                        const c = diario.soma.cats.get(cat);
                        return (
                          <TableCell key={cat} className="text-right align-top">
                            <span className="num">{(c?.qty ?? 0).toLocaleString("pt-BR")}</span>
                            <span className="num block text-xs font-normal text-muted-foreground">{fmt(c?.value ?? 0)}</span>
                          </TableCell>
                        );
                      })}
                      <TableCell className="num text-right">{diario.soma.alteracoes}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
        )}
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
                        <div>gaveta {fmt((t.expected_cash_cents ?? 0) / 100)}</div>
                        {t.expected_card_cents !== null && t.expected_card_cents !== undefined && (
                          <div>
                            maquininha {fmt(t.expected_card_cents / 100)}
                            {t.card_difference_cents !== null && t.card_difference_cents !== undefined && t.card_difference_cents !== 0 && (
                              <span style={{ color: t.card_difference_cents < 0 ? "var(--destructive)" : "var(--warning)" }}>
                                {" "}({t.card_difference_cents < 0 ? "falta" : "sobra"} {fmt(Math.abs(t.card_difference_cents) / 100)})
                              </span>
                            )}
                          </div>
                        )}
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
              <Label>Fichas e pendências em aberto agora</Label>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-secondary p-3 text-sm">
                  <span className="num text-xl font-bold">{emAberto.fichas}</span> ficha(s)
                  <span className="block text-xs text-muted-foreground">pagas e ainda não retiradas · sobra no estoque físico</span>
                </div>
                <div className="rounded-lg bg-secondary p-3 text-sm">
                  <span className="num text-xl font-bold">{emAberto.pendencias}</span> pendência(s)
                  {emAberto.pendencias > 0 && <span className="num"> · {fmt(emAberto.pendenteCents / 100)} a receber</span>}
                  <span className="block text-xs text-muted-foreground">retiradas e ainda não pagas · falta no caixa</span>
                </div>
              </div>
            </div>
            <div>
              <Label>Itens alterados no período</Label>
              {alteredItems.length === 0 ? (
                <p className="mt-1 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Nenhum pedido alterado.</p>
              ) : (
                <div className="mt-1 rounded-lg border bg-secondary/40 p-3 text-sm">
                  <p className="mb-2 font-semibold text-destructive">
                    {alteredItems.length} item(ns) alterado(s) · {fmt(alteredItems.reduce((s, a) => s + Number(a.amount), 0))}
                  </p>
                  <ul className="space-y-1">
                    {alteredItems.map((a) => (
                      <li key={a.id}>
                        #{String(a.sale_number).padStart(5, "0")} · {a.quantity}× {a.product_name} · {fmt(Number(a.amount))} · por <b>{a.actor_name || "-"}</b> em {fmtDate(a.occurred_at)} · motivo: <i>{a.reason || "-"}</i>
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

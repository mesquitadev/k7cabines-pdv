import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Printer, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoMoeda } from "@/components/campo-moeda";
import { imprimirCupom } from "@/lib/impressao";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { Rotulo } from "@/components/placa";
import { desktop, desktopToken, type LocalCreditVoucher } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * Fichas em aberto: o que o cliente pagou e ainda não levou.
 *
 * A busca é por nome ou por número do pedido. Não há cadastro de cliente — o
 * nome é apelido de fila, e o número do pedido resolve homônimo.
 */

const dinheiro = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Filtro = "todas" | "ficha" | "pendencia";

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function DrawerFichas({
  aberto,
  onFechar,
  onRetirou,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** O estoque muda a cada retirada; o catálogo precisa recarregar. */
  onRetirou: () => void | Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [fichas, setFichas] = useState<LocalCreditVoucher[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  /* Pendência sendo recebida: id → valores digitados. */
  const [recebendo, setRecebendo] = useState<{ id: string; cash: number; card: number } | null>(null);
  /* Chave da retirada em curso: dois cliques entregam uma vez só. */
  const idRetirada = useRef(crypto.randomUUID());

  const carregar = useCallback(async (termo: string) => {
    const token = desktopToken();
    if (!token) return;
    try {
      setFichas(await desktop.listCreditVouchers(token, termo));
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível ler as fichas");
      setFichas([]);
    }
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setBusca("");
    carregar("");
  }, [aberto, carregar]);

  useEffect(() => {
    if (!aberto) return;
    // Espera a digitação parar para não consultar a cada tecla.
    const t = setTimeout(() => carregar(busca), 250);
    return () => clearTimeout(t);
  }, [busca, aberto, carregar]);

  const reimprimir = async (voucherId: string) => {
    const token = desktopToken();
    if (!token) return;
    try {
      await desktop.reprintCreditVoucher(token, voucherId);
      toast.success("Ficha reimpressa");
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível imprimir");
    }
  };

  /** Recebe a pendência: o dinheiro entra no turno de agora e o cupom sai. */
  const receber = async (f: LocalCreditVoucher) => {
    const token = desktopToken();
    if (!token || !recebendo || recebendo.id !== f.id) return;
    if (recebendo.cash + recebendo.card < f.pending_cents) {
      return toast.error("Valor pago é menor que a pendência");
    }
    setOcupado(true);
    try {
      await desktop.settlePending(token, {
        voucher_id: f.id,
        cash_cents: recebendo.cash,
        card_cents: recebendo.card,
      });
      const troco = recebendo.cash > 0 ? recebendo.cash + recebendo.card - f.pending_cents : 0;
      toast.success(
        troco > 0 ? `Pendência recebida · troco ${dinheiro(troco)}` : "Pendência recebida",
      );
      setRecebendo(null);
      await imprimirCupom(f.sale_id);
      await carregar(busca);
      await onRetirou();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível receber");
    } finally {
      setOcupado(false);
    }
  };

  const retirar = async (itemId: string, produto: string) => {
    const token = desktopToken();
    if (!token) return;
    setOcupado(true);
    try {
      await desktop.withdrawCredit(token, {
        voucher_item_id: itemId,
        quantity: 1,
        client_withdrawal_id: idRetirada.current,
      });
      idRetirada.current = crypto.randomUUID();
      toast.success(`${produto} entregue`);
      await carregar(busca);
      await onRetirou();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível entregar");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <PainelLateral
      aberto={aberto}
      onAbertoMudou={(a) => !a && onFechar()}
      icone={Ticket}
      titulo="Fichas e pendências"
      descricao="Ficha: pagou, retira depois · Pendência: levou, paga na retirada"
      largura="sm:max-w-xl"
      rodape={
        <Button variant="outline" className="h-11 rounded-sm px-5" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      <SecaoForm titulo="Procurar">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Código da ficha (K7-XXXX), nome ou nº do pedido"
            aria-label="Procurar ficha por nome ou número do pedido"
            className="campo h-12 rounded-sm pl-10"
          />
        </div>
        <div className="mt-3 flex gap-1" role="tablist" aria-label="Tipo">
          {(
            [
              ["todas", "Todas"],
              ["ficha", "Fichas"],
              ["pendencia", "Pendências"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={filtro === valor}
              onClick={() => setFiltro(valor)}
              className={cn(
                "rotulo h-10 border px-3 text-[11px] transition-colors",
                filtro === valor
                  ? "border-transparent bg-secondary text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {rotulo}
              <span className="num ml-1.5 opacity-70">
                {valor === "todas" ? fichas.length : fichas.filter((f) => f.kind === valor).length}
              </span>
            </button>
          ))}
        </div>
      </SecaoForm>

      {fichas.filter((f) => filtro === "todas" || f.kind === filtro).length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {busca.trim()
            ? `Nada em aberto para “${busca.trim()}”.`
            : "Nenhuma ficha ou pendência em aberto no momento."}
        </p>
      ) : (
        <div className="space-y-3">
          {fichas
            .filter((f) => filtro === "todas" || f.kind === filtro)
            .map((f) => (
            <section
              key={f.id}
              className={cn("placa p-4", f.kind === "pendencia" && "border-warning")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg">
                  <span
                    className="rotulo mr-2 text-[10px]"
                    style={{ color: f.kind === "pendencia" ? "var(--warning)" : "var(--success)" }}
                  >
                    {f.kind === "pendencia" ? "Pendência" : "Ficha"}
                  </span>
                  {f.code && <span className="num font-bold">K7-{f.code}</span>}
                  {f.code && f.customer_name && " · "}
                  {f.customer_name}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="rotulo num text-[11px] text-muted-foreground">
                    pedido {String(f.sale_number).padStart(5, "0")} · {hora(f.created_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => reimprimir(f.id)}
                    title="Reimprimir a ficha"
                    aria-label={`Reimprimir a ficha de ${f.customer_name}`}
                    className="campo grid h-11 w-11 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    <Printer className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              {f.kind === "pendencia" ? (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {f.items.map((i) => (
                        <div key={i.id} className="font-semibold">
                          {i.quantity}× {i.product_name}
                        </div>
                      ))}
                      <div className="rotulo num text-[10px] text-muted-foreground">
                        levou na hora · paga na retirada
                      </div>
                    </div>
                    <div className="num text-2xl font-bold">{dinheiro(f.pending_cents)}</div>
                  </div>
                  {recebendo?.id === f.id ? (
                    <div className="space-y-2 border-t border-border pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <CampoMoeda
                            id={`cash-${f.id}`}
                            rotulo="Dinheiro"
                            centavos={recebendo.cash}
                            onChange={(c) =>
                              setRecebendo({
                                id: f.id,
                                cash: c,
                                card: Math.max(f.pending_cents - c, 0),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <CampoMoeda
                            id={`card-${f.id}`}
                            rotulo="Maquininha"
                            centavos={recebendo.card}
                            onChange={(c) =>
                              setRecebendo({ id: f.id, cash: recebendo.cash, card: Math.min(c, f.pending_cents) })
                            }
                          />
                        </div>
                      </div>
                      {recebendo.cash + recebendo.card > f.pending_cents && recebendo.cash > 0 && (
                        <p className="num text-xs text-muted-foreground">
                          troco {dinheiro(recebendo.cash + recebendo.card - f.pending_cents)}
                        </p>
                      )}
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          className="h-11 rounded-sm px-4"
                          onClick={() => setRecebendo(null)}
                          disabled={ocupado}
                        >
                          Cancelar
                        </Button>
                        <Button
                          variant="ghost"
                          className="acao-receber h-11 rounded-sm px-5 font-bold uppercase"
                          style={{ fontFamily: "var(--font-display)" }}
                          onClick={() => receber(f)}
                          disabled={ocupado || recebendo.cash + recebendo.card < f.pending_cents}
                        >
                          Confirmar e imprimir
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      className="acao-receber h-12 w-full rounded-sm font-bold uppercase"
                      style={{ fontFamily: "var(--font-display)" }}
                      disabled={ocupado}
                      onClick={() => setRecebendo({ id: f.id, cash: f.pending_cents, card: 0 })}
                    >
                      Receber {dinheiro(f.pending_cents)}
                    </Button>
                  )}
                </div>
              ) : (
              <div className="mt-3 divide-y divide-border">
                {f.items.map((i) => {
                  const resta = i.quantity - i.taken_quantity;
                  return (
                    <div
                      key={i.id}
                      className={cn(
                        "flex items-center gap-3 py-2.5",
                        resta === 0 && "opacity-45",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{i.product_name}</div>
                        <div className="rotulo num text-[10px] text-muted-foreground">
                          {i.taken_quantity} de {i.quantity} retirado(s)
                          {resta > 0 && ` · restam ${resta}`}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        className="acao-receber h-12 shrink-0 rounded-sm px-5 font-bold uppercase"
                        disabled={ocupado || resta === 0}
                        onClick={() => retirar(i.id, i.product_name)}
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {resta === 0 ? "Entregue" : "Entregar 1"}
                      </Button>
                    </div>
                  );
                })}
              </div>
              )}
            </section>
          ))}
        </div>
      )}
    </PainelLateral>
  );
}

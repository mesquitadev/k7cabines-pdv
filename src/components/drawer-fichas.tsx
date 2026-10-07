import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Printer, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      titulo="Fichas em aberto"
      descricao="Pago no caixa, retirado aos poucos"
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
      </SecaoForm>

      {fichas.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {busca.trim()
            ? `Nenhuma ficha em aberto para “${busca.trim()}”.`
            : "Nenhuma ficha em aberto no momento."}
        </p>
      ) : (
        <div className="space-y-3">
          {fichas.map((f) => (
            <section key={f.id} className="placa p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg">
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
            </section>
          ))}
        </div>
      )}
    </PainelLateral>
  );
}

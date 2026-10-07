import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { Selecao } from "@/components/selecao";
import { Rotulo } from "@/components/placa";
import { desktop, desktopToken, type SaleItemForReturn } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * Devolução de item de uma venda já fechada.
 *
 * Devolver não apaga a venda: registra o estorno por cima dela. O cupom
 * original continua existindo, e é isso que faz o fechamento do turno bater no
 * fim do dia — apagar a venda faria o dinheiro sumir da conferência.
 */

const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ESTORNOS = [
  { valor: "dinheiro", rotulo: "Dinheiro da gaveta" },
  { valor: "cartao", rotulo: "Estorno na maquininha" },
  { valor: "sem_estorno", rotulo: "Sem estorno (troca)" },
];

export function DrawerDevolucao({
  venda,
  onFechar,
  onDevolvido,
}: {
  venda: { id: string; sale_number: number; total_cents: number } | null;
  onFechar: () => void;
  onDevolvido: () => void | Promise<void>;
}) {
  const [itens, setItens] = useState<SaleItemForReturn[]>([]);
  const [alvo, setAlvo] = useState<SaleItemForReturn | null>(null);
  const [quantidade, setQuantidade] = useState("1");
  const [estorno, setEstorno] = useState("dinheiro");
  const [motivo, setMotivo] = useState("");
  const [repor, setRepor] = useState(true);
  const [salvando, setSalvando] = useState(false);
  /**
   * Chave desta devolução, renovada só depois do sucesso.
   *
   * Sem ela, o segundo clique — ou uma repetição depois de erro de rede
   * aparente — devolvia de novo: repunha estoque duas vezes e tirava dinheiro
   * da gaveta duas vezes.
   */
  const idDaDevolucao = useRef(crypto.randomUUID());

  const carregar = useCallback(async () => {
    const token = desktopToken();
    if (!token || !venda) return;
    try {
      setItens(await desktop.saleItemsForReturn(token, venda.id));
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível abrir a venda");
    }
  }, [venda]);

  useEffect(() => {
    if (!venda) return;
    setAlvo(null);
    setQuantidade("1");
    setEstorno("dinheiro");
    setMotivo("");
    setRepor(true);
    carregar();
  }, [venda, carregar]);

  const qtd = parseInt(quantidade, 10);
  const disponivel = alvo ? alvo.quantity - alvo.returned_quantity : 0;
  const valida = alvo && !Number.isNaN(qtd) && qtd > 0 && qtd <= disponivel;
  const valorEstorno = alvo && valida ? alvo.unit_price_cents * qtd : 0;

  const devolver = async () => {
    const token = desktopToken();
    if (!token || !alvo) return;
    if (!valida) return toast.error(`Quantidade inválida: há ${disponivel} a devolver`);
    if (!motivo.trim()) return toast.error("Informe o motivo da devolução");

    setSalvando(true);
    try {
      await desktop.returnSaleItem(token, {
        sale_item_id: alvo.sale_item_id,
        quantity: qtd,
        refund_kind: estorno,
        reason: motivo.trim(),
        restock: repor,
        client_return_id: idDaDevolucao.current,
      });
      idDaDevolucao.current = crypto.randomUUID();
      toast.success(`${qtd} × ${alvo.product_name} devolvido`);
      setAlvo(null);
      setMotivo("");
      await carregar();
      await onDevolvido();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível devolver");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <PainelLateral
      aberto={!!venda}
      onAbertoMudou={(a) => !a && onFechar()}
      icone={Undo2}
      titulo="Devolver item"
      descricao={
        venda && `Pedido ${String(venda.sale_number).padStart(5, "0")} · ${fmt(venda.total_cents)}`
      }
      largura="sm:max-w-lg"
      confirmarDescarte={!!alvo && motivo.trim().length > 0}
      rodape={
        <>
          <Button variant="outline" className="h-11 rounded-sm px-5" onClick={onFechar}>
            Fechar
          </Button>
          <Button
            variant="ghost"
            className="acao-destrutiva h-11 rounded-sm px-6 font-bold uppercase"
            disabled={salvando || !valida || !motivo.trim()}
            onClick={devolver}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Devolvendo…" : `Devolver ${valorEstorno ? fmt(valorEstorno) : ""}`}
          </Button>
        </>
      }
    >
      <SecaoForm titulo="Item da venda">
        {itens.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Esta venda não tem itens disponíveis para devolução.
          </p>
        ) : (
          <div className="painel divide-y divide-border overflow-hidden">
            {itens.map((i) => {
              const resta = i.quantity - i.returned_quantity;
              return (
                <button
                  key={i.sale_item_id}
                  type="button"
                  disabled={resta <= 0}
                  onClick={() => {
                    setAlvo(i);
                    setQuantidade(String(Math.min(1, resta)));
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    alvo?.sale_item_id === i.sale_item_id ? "bg-secondary" : "hover:bg-accent/40",
                    resta <= 0 && "opacity-40",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{i.product_name}</span>
                    <span className="rotulo num block text-[10px] text-muted-foreground">
                      {i.quantity} vendido(s) · {i.returned_quantity} devolvido(s) ·{" "}
                      {resta > 0 ? `${resta} disponível(is)` : "nada a devolver"}
                    </span>
                  </span>
                  <span className="num shrink-0 text-sm">{fmt(i.unit_price_cents)}</span>
                </button>
              );
            })}
          </div>
        )}
      </SecaoForm>

      {alvo && (
        <SecaoForm titulo="Devolução">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="devQtd">Quantidade</Label>
              <Input
                id="devQtd"
                type="number"
                min="1"
                max={disponivel}
                autoFocus
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                className="campo num h-11 rounded-sm"
              />
              <p className="text-xs text-muted-foreground">Até {disponivel}.</p>
            </div>
            <Selecao
              id="devEstorno"
              rotulo="Como devolver o dinheiro"
              valor={estorno}
              onChange={setEstorno}
              opcoes={ESTORNOS.map((e) => ({ valor: e.valor, rotulo: e.rotulo }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="devMotivo">Motivo (obrigatório)</Label>
            <Input
              id="devMotivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: cliente desistiu, produto com defeito"
              className="campo h-11 rounded-sm"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 border border-border p-3">
            <input
              type="checkbox"
              className="marcador mt-0.5 shrink-0"
              checked={repor}
              onChange={(e) => setRepor(e.target.checked)}
            />
            <span>
              <span className="block text-sm">Devolver ao estoque</span>
              <span className="block text-xs text-muted-foreground">
                Volta para os lotes de onde saiu, na ordem inversa. Desmarque quando o produto
                voltou danificado e não pode ser vendido de novo.
              </span>
            </span>
          </label>

          <div className="painel flex items-baseline justify-between px-3 py-2">
            <Rotulo>
              {estorno === "sem_estorno" ? "Sem devolução de dinheiro" : "A estornar"}
            </Rotulo>
            <span className="num text-xl font-bold tabular-nums">
              {estorno === "sem_estorno" ? "—" : fmt(valorEstorno)}
            </span>
          </div>

          {estorno === "dinheiro" && (
            <p className="text-xs" style={{ color: "var(--warning)" }}>
              Sai da gaveta e entra na conferência do fechamento do turno.
            </p>
          )}
        </SecaoForm>
      )}
    </PainelLateral>
  );
}

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownUp, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { CampoMoeda } from "@/components/campo-moeda";
import { Rotulo } from "@/components/placa";
import { Selecao } from "@/components/selecao";
import { desktop, desktopToken } from "@/lib/desktop";

/**
 * Um diálogo só para tudo que mexe no saldo.
 *
 * Antes eram três — Adicionar, Remover e Inventário — em três botões na linha
 * do produto. Mas quem está com a mercadoria na mão pensa "vou registrar um
 * movimento" e só depois decide o tipo. Três portas para a mesma sala é
 * navegação a mais e três layouts para manter.
 */

export type TipoMovimento = "entrada" | "saida" | "inventario";

type Alvo = {
  id: string;
  name: string;
  variantName?: string;
  stock: number;
  unit?: string;
  cost: number;
  category: string;
};

type Lote = { id: string; expiry_date: string; quantity: number };

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hojeISO = () => new Date().toISOString().slice(0, 10);
const dataBR = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");

const TIPOS: { valor: TipoMovimento; nome: string; permissao: string }[] = [
  { valor: "entrada", nome: "Entrada (compra)", permissao: "stock.add" },
  { valor: "saida", nome: "Saída (perda, quebra, uso)", permissao: "stock.remove" },
  { valor: "inventario", nome: "Inventário (contagem)", permissao: "stock.inventory" },
];

export function DialogoMovimento({
  alvo,
  lotes,
  exigeValidade,
  pode,
  fornecedores,
  fornecedorPadrao,
  tipoInicial,
  onFechar,
  onPronto,
}: {
  alvo: Alvo | null;
  lotes: Lote[];
  exigeValidade: boolean;
  pode: (permissao: string) => boolean;
  fornecedores: { id: string; name: string }[];
  /** Fornecedor habitual do produto, já escolhido para a compra. */
  fornecedorPadrao: string;
  tipoInicial: TipoMovimento;
  onFechar: () => void;
  onPronto: () => void | Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoMovimento>(tipoInicial);
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState(0);
  const [validade, setValidade] = useState("");
  const [nota, setNota] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!alvo) return;
    setTipo(tipoInicial);
    setQuantidade(tipoInicial === "inventario" ? String(alvo.stock) : "");
    setCusto(Math.round(alvo.cost * 100));
    setValidade("");
    setNota("");
    setFornecedor(fornecedorPadrao);
  }, [alvo, tipoInicial, fornecedorPadrao]);

  const disponiveis = useMemo(() => TIPOS.filter((t) => pode(t.permissao)), [pode]);
  const qtd = parseInt(quantidade, 10);
  const qtdValida = !Number.isNaN(qtd) && (tipo === "inventario" ? qtd >= 0 : qtd > 0);

  /* O saldo depois do movimento, mostrado antes de confirmar: é a pergunta que
     a pessoa faz de cabeça, e errar aqui custa uma contagem inteira. */
  const saldoDepois = !alvo
    ? 0
    : tipo === "entrada"
      ? alvo.stock + (qtdValida ? qtd : 0)
      : tipo === "saida"
        ? alvo.stock - (qtdValida ? qtd : 0)
        : qtdValida
          ? qtd
          : alvo.stock;

  const registrar = async () => {
    if (!alvo) return;
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    if (!qtdValida) return toast.error("Informe uma quantidade válida");
    if (tipo === "saida" && qtd > alvo.stock) {
      return toast.error(`Só há ${alvo.stock} em estoque`);
    }
    if (tipo === "entrada" && exigeValidade && !validade) {
      return toast.error("Data de validade obrigatória para esta categoria");
    }
    if (tipo === "inventario" && !nota.trim()) {
      return toast.error("Informe o motivo do ajuste de inventário");
    }

    setSalvando(true);
    try {
      if (tipo === "entrada") {
        await desktop.addStock(token, {
          product_id: alvo.id,
          quantity: qtd,
          expiry_date: exigeValidade ? validade : validade || null,
          unit_cost_cents: custo > 0 ? custo : null,
          note: nota.trim() || null,
          supplier_id: fornecedor || null,
        });
        toast.success(`+${qtd} ${alvo.unit ?? "UN"} em ${alvo.name}`);
      } else if (tipo === "saida") {
        await desktop.removeStock(token, {
          product_id: alvo.id,
          quantity: qtd,
          note: nota.trim() || null,
        });
        toast.success(`−${qtd} ${alvo.unit ?? "UN"} em ${alvo.name}`);
      } else {
        await desktop.inventoryCount(token, {
          product_id: alvo.id,
          counted_quantity: qtd,
          reason: nota.trim(),
        });
        toast.success(`${alvo.name}: saldo ajustado para ${qtd}`);
      }
      onFechar();
      await onPronto();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível registrar o movimento");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <PainelLateral
      aberto={!!alvo}
      onAbertoMudou={(aberto) => !aberto && onFechar()}
      icone={ArrowDownUp}
      titulo="Registrar movimento"
      descricao={
        alvo && (
          <>
            {alvo.variantName ? `${alvo.name} · ${alvo.variantName}` : alvo.name} · saldo atual{" "}
            <strong className="num">
              {alvo.stock} {alvo.unit ?? "UN"}
            </strong>
          </>
        )
      }
      largura="sm:max-w-md"
      confirmarDescarte={!!quantidade || !!nota}
      rodape={
        <>
          <Button variant="outline" className="h-11 rounded-sm px-5" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="ghost"
            className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
            disabled={salvando || !qtdValida}
            onClick={registrar}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Registrando…" : "Registrar"}
          </Button>
        </>
      }
    >
      <SecaoForm titulo="Movimento">
        <Selecao
          id="movTipo"
          rotulo="Tipo"
          valor={tipo}
          onChange={(v) => setTipo(v as TipoMovimento)}
          opcoes={disponiveis.map((t) => ({ valor: t.valor, rotulo: t.nome }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="movQtd">
              {tipo === "inventario" ? "Quantidade contada" : "Quantidade"}
            </Label>
            <Input
              id="movQtd"
              type="number"
              min="0"
              step="1"
              autoFocus
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="campo num h-11 rounded-sm"
            />
          </div>
          {tipo === "entrada" && (
            <CampoMoeda
              id="movCusto"
              rotulo="Custo unitário"
              centavos={custo}
              onChange={setCusto}
              ajuda="Atualiza o custo médio."
            />
          )}
        </div>

        {tipo === "entrada" && fornecedores.length > 0 && (
          <Selecao
            id="movForn"
            rotulo="Fornecedor"
            valor={fornecedor}
            onChange={setFornecedor}
            placeholder="Não informado"
            ajuda="Fica gravado nesta compra, mesmo que o produto mude de fornecedor depois."
            opcoes={[
              { valor: "", rotulo: "— não informado —" },
              ...fornecedores.map((f) => ({ valor: f.id, rotulo: f.name })),
            ]}
          />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="movNota">
            {tipo === "inventario" ? "Motivo do ajuste (obrigatório)" : "Motivo / observação"}
          </Label>
          <Input
            id="movNota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={
              tipo === "entrada"
                ? "Ex.: NF 1234, fornecedor Alfa"
                : tipo === "saida"
                  ? "Ex.: quebra na prateleira"
                  : "Ex.: contagem mensal"
            }
            className="campo h-11 rounded-sm"
          />
        </div>

        <div className="painel flex items-baseline justify-between px-3 py-2">
          <Rotulo>Saldo depois</Rotulo>
          <span
            className="num text-xl font-bold tabular-nums"
            style={saldoDepois < 0 ? { color: "var(--destructive)" } : undefined}
          >
            {saldoDepois} {alvo?.unit ?? "UN"}
          </span>
        </div>
      </SecaoForm>

      {/* A validade ganha bloco próprio: é o dado que o operador esquece, e sem
          ele o FEFO na venda deixa de funcionar. */}
      {tipo === "entrada" && (
        <SecaoForm titulo="Lote e validade">
          <div
            className="space-y-1.5 border p-3"
            style={{
              borderColor: exigeValidade ? "var(--warning)" : "var(--border)",
              background: exigeValidade
                ? "color-mix(in oklab, var(--warning) 10%, transparent)"
                : undefined,
            }}
          >
            <Label htmlFor="movVal" className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Validade {exigeValidade && "(obrigatória)"}
            </Label>
            <Input
              id="movVal"
              type="date"
              min={hojeISO()}
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              className="campo h-11 w-52 rounded-sm"
            />
            <p className="text-xs text-muted-foreground">
              {exigeValidade
                ? "Este produto é controlado por validade: a venda consome primeiro o lote que vence antes."
                : "Pulseiras não exigem validade. Se informar, o lote passa a ser controlado."}
            </p>
          </div>

          {lotes.length > 0 && (
            <div>
              <Rotulo className="mb-1.5 block">Lotes em estoque</Rotulo>
              <div className="painel max-h-40 divide-y divide-border overflow-y-auto">
                {lotes.map((l) => (
                  <div key={l.id} className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="num text-muted-foreground">val. {dataBR(l.expiry_date)}</span>
                    <span className="num">{l.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {custo > 0 && (
            <p className="text-xs text-muted-foreground">
              Custo médio hoje: <span className="num">{fmt(alvo?.cost ?? 0)}</span>. Esta entrada
              recalcula a média com o saldo que já existe.
            </p>
          )}
        </SecaoForm>
      )}
    </PainelLateral>
  );
}

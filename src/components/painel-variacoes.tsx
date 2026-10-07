import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Layers, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Rotulo } from "@/components/placa";
import { CampoGtin, CampoSku } from "@/components/campos-identificacao";
import { desktop, desktopToken } from "@/lib/desktop";
import { checarGtin, checarSku, sugerirSku } from "@/lib/identificacao";

/**
 * Variações de um produto, editadas de dentro do produto pai.
 *
 * A variação nasce aqui e não numa tela separada porque é assim que a pessoa
 * pensa: "esse gel também tem de 100 ml". Cadastrar um produto solto e depois
 * apontar o pai num select é a ordem inversa do raciocínio.
 *
 * Cada variação carrega o próprio GTIN. Não é escolha nossa: a GS1 exige um
 * GTIN distinto por variação vendável — tamanho, cor, conteúdo ou embalagem
 * diferentes são produtos diferentes para o leitor.
 */

type Variacao = {
  id: string;
  code: string;
  name: string;
  variantName?: string;
  price: number;
  stock: number;
  barcode: string | null;
};

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const VAZIO = { variantName: "", code: "", barcode: "", price: "", cost: "" };

export function PainelVariacoes({
  pai,
  variacoes,
  categoriaId,
  categoria,
  codigosUsados,
  podeCriar,
  onMudou,
}: {
  pai: { id: string; name: string };
  variacoes: Variacao[];
  categoriaId: string | null;
  categoria: string;
  codigosUsados: Set<string>;
  podeCriar: boolean;
  onMudou: () => void | Promise<void>;
}) {
  const [novo, setNovo] = useState<typeof VAZIO | null>(null);
  const [salvando, setSalvando] = useState(false);

  const erroSku = useMemo(
    () => (novo?.code ? checarSku(novo.code) : null),
    [novo?.code],
  );
  const checagemEan = useMemo(
    () => checarGtin(novo?.barcode ?? ""),
    [novo?.barcode],
  );

  const abrir = () => {
    const nome = "";
    setNovo({
      ...VAZIO,
      // O SKU já vem sugerido a partir do pai: quem cadastra a terceira
      // variação do dia não deve ter que inventar um código.
      code: sugerirSku(categoria, pai.name + nome, codigosUsados),
    });
  };

  const salvar = async () => {
    if (!novo) return;
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    if (!novo.variantName.trim()) return toast.error("Dê um nome à variação: 50 ml, P, azul…");
    if (erroSku) return toast.error(erroSku);
    if (checagemEan.estado === "erro") return toast.error(checagemEan.mensagem);

    setSalvando(true);
    try {
      await desktop.createProduct(token, {
        code: novo.code,
        name: pai.name,
        category: categoria,
        category_id: categoriaId,
        parent_id: pai.id,
        variant_name: novo.variantName.trim(),
        price_cents: Math.round((parseFloat(novo.price) || 0) * 100),
        cost_cents: Math.round((parseFloat(novo.cost) || 0) * 100),
        barcode: checagemEan.estado === "ok" ? checagemEan.digitos : null,
      });
      toast.success(`Variação ${novo.variantName.trim()} criada`);
      setNovo(null);
      await onMudou();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível criar a variação");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Rotulo className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" aria-hidden /> Variações
        </Rotulo>
        {podeCriar && !novo && (
          <Button
            type="button"
            variant="outline"
            className="campo h-9 rounded-sm px-3 text-xs"
            onClick={abrir}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Nova variação
          </Button>
        )}
      </div>

      {variacoes.length === 0 && !novo ? (
        <p className="text-xs text-muted-foreground">
          Sem variações. Crie uma quando o mesmo produto tiver tamanhos, volumes ou cores
          diferentes — cada uma com preço, estoque e código de barras próprios.
        </p>
      ) : (
        <div className="painel divide-y divide-border overflow-hidden">
          {variacoes.map((v) => (
            <div key={v.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
              <span className="min-w-[7rem] flex-1 text-sm font-semibold">
                {v.variantName || "—"}
              </span>
              <span className="rotulo num text-[10px] text-muted-foreground">{v.code}</span>
              <span className="num text-[11px] text-muted-foreground">
                {v.barcode ?? "sem EAN"}
              </span>
              <span className="num text-sm">{fmt(v.price)}</span>
              <span className="num text-xs text-muted-foreground">{v.stock} em estoque</span>
            </div>
          ))}
        </div>
      )}

      {novo && (
        <div className="placa mt-3 space-y-3 p-4">
          <div className="flex items-center justify-between">
            <Rotulo>Nova variação de {pai.name}</Rotulo>
            <button
              type="button"
              aria-label="Cancelar nova variação"
              onClick={() => setNovo(null)}
              className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vnome">Nome da variação</Label>
              <Input
                id="vnome"
                autoFocus
                value={novo.variantName}
                onChange={(e) => setNovo({ ...novo, variantName: e.target.value })}
                placeholder="50 ml, P, azul…"
                className="campo h-11 rounded-sm"
              />
            </div>
            <CampoSku
              id="vsku"
              valor={novo.code}
              erro={erroSku}
              onChange={(v) => setNovo({ ...novo, code: v })}
              onSugerir={() =>
                setNovo({
                  ...novo,
                  code: sugerirSku(categoria, `${pai.name}${novo.variantName}`, codigosUsados),
                })
              }
            />
          </div>

          <CampoGtin
            id="vean"
            valor={novo.barcode}
            checagem={checagemEan}
            onChange={(v) => setNovo({ ...novo, barcode: v })}
            ajuda="Cada variação tem o seu: a GS1 exige um código por tamanho ou volume."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vpreco">Preço de venda (R$)</Label>
              <Input
                id="vpreco"
                type="number"
                step="0.01"
                min="0"
                value={novo.price}
                onChange={(e) => setNovo({ ...novo, price: e.target.value })}
                className="campo num h-11 rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vcusto">Custo de compra (R$)</Label>
              <Input
                id="vcusto"
                type="number"
                step="0.01"
                min="0"
                value={novo.cost}
                onChange={(e) => setNovo({ ...novo, cost: e.target.value })}
                className="campo num h-11 rounded-sm"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            A variação nasce sem saldo. Use Adicionar na linha dela para dar entrada com lote e
            validade.
          </p>

          <Button
            type="button"
            variant="ghost"
            className="acao-receber h-11 w-full rounded-sm font-bold uppercase"
            disabled={salvando}
            onClick={salvar}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Criando…" : "Criar variação"}
          </Button>
        </div>
      )}
    </section>
  );
}

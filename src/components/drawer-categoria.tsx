import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { Rotulo } from "@/components/placa";
import { desktop, desktopToken, type LocalCategory } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/** As cores disponíveis são as linhas do sistema: uma cor, um significado. */
const CORES = [
  { valor: "var(--linha-pulseira)", nome: "Rosa" },
  { valor: "var(--linha-bebida)", nome: "Cobalto" },
  { valor: "var(--linha-erotico)", nome: "Violeta" },
  { valor: "var(--linha-outro)", nome: "Turquesa" },
];

/**
 * Cadastro rápido de categoria, aberto de dentro do formulário de produto.
 *
 * Existe porque a falta de uma categoria só aparece na hora de cadastrar o
 * produto. Mandar a pessoa sair, ir na aba Categorias, criar e voltar custa o
 * formulário inteiro que ela já tinha preenchido.
 */
export function DrawerCategoria({
  aberto,
  paiId,
  categorias,
  onFechar,
  onCriada,
}: {
  aberto: boolean;
  /** Quando vem preenchido, o que se cria é uma subcategoria dele. */
  paiId: string | null;
  categorias: LocalCategory[];
  onFechar: () => void;
  /** Recebe a categoria criada para já deixá-la escolhida no produto. */
  onCriada: (criada: LocalCategory) => void | Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES[3].valor);
  const [ordem, setOrdem] = useState(10);
  const [piscar, setPiscar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const pai = paiId ? categorias.find((c) => c.id === paiId) : null;

  useEffect(() => {
    if (!aberto) return;
    setNome("");
    setPiscar(false);
    setCor(CORES[3].valor);
    setOrdem(paiId ? 100 : (categorias.filter((c) => !c.parent_id).length + 1) * 10);
  }, [aberto, paiId, categorias]);

  const salvar = async () => {
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    if (nome.trim().length < 2) return toast.error("O nome precisa de pelo menos 2 caracteres");

    setSalvando(true);
    try {
      const criada = await desktop.createCategory(token, {
        name: nome.trim(),
        parent_id: paiId,
        // Subcategoria herda a cor da mãe: uma cor, um significado.
        color: paiId ? "" : cor,
        sort_order: ordem,
        highlight: piscar,
      });
      toast.success(paiId ? "Subcategoria criada" : "Categoria criada");
      onFechar();
      await onCriada(criada);
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível criar");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <PainelLateral
      aberto={aberto}
      onAbertoMudou={(a) => !a && onFechar()}
      icone={FolderPlus}
      titulo={pai ? "Nova subcategoria" : "Nova categoria"}
      descricao={pai ? `Dentro de ${pai.name}` : "A cor vale na venda, no estoque e nos relatórios."}
      largura="sm:max-w-md"
      confirmarDescarte={nome.trim().length > 0}
      rodape={
        <>
          <Button variant="outline" className="h-11 rounded-sm px-5" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="ghost"
            className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
            disabled={salvando || nome.trim().length < 2}
            onClick={salvar}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Criando…" : "Criar"}
          </Button>
        </>
      }
    >
      <SecaoForm titulo="Identificação">
        <div className="space-y-1.5">
          <Label htmlFor="novaCat">Nome</Label>
          <Input
            id="novaCat"
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={pai ? "Ex.: Cerveja" : "Ex.: Bebidas"}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
            }}
            className="campo h-11 rounded-sm"
          />
        </div>
      </SecaoForm>

      {!pai && (
        <SecaoForm titulo="Aparência e ordem">
          <div className="space-y-1.5">
            <Rotulo>Cor da linha</Rotulo>
            <div className="flex flex-wrap gap-2">
              {CORES.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  onClick={() => setCor(c.valor)}
                  aria-pressed={cor === c.valor}
                  className={cn(
                    "rotulo flex h-11 items-center gap-2 border px-3 text-[11px] transition-colors",
                    cor === c.valor
                      ? "border-transparent bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span aria-hidden className="h-3 w-5" style={{ background: c.valor }} />
                  {c.nome}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="novaOrdem">Ordem na venda</Label>
            <Input
              id="novaOrdem"
              type="number"
              min="0"
              step="10"
              value={ordem}
              onChange={(e) => setOrdem(parseInt(e.target.value, 10) || 0)}
              className="campo num h-11 w-28 rounded-sm"
            />
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 border border-border p-2.5">
              <input
                type="checkbox"
                className="marcador mt-0.5 shrink-0"
                checked={piscar}
                onChange={(e) => setPiscar(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-sm">Piscar na venda</span>
                <span className="block text-xs text-muted-foreground">
                  A tela do caixa pisca enquanto um produto desta categoria estiver no pedido.
                </span>
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              Menor aparece primeiro no catálogo do balcão.
            </p>
          </div>
        </SecaoForm>
      )}
    </PainelLateral>
  );
}

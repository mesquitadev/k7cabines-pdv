import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Selecao } from "@/components/selecao";
import { Ajuda } from "@/components/ajuda";
import type { LocalCategory } from "@/lib/desktop";

/**
 * Categoria e subcategoria, encadeadas.
 *
 * Uma lista só, com "Bebidas › Cerveja" achatado dentro, cresce rápido e
 * esconde a hierarquia justamente onde ela importa. Dois campos: o segundo só
 * oferece as filhas do primeiro, e trocar a categoria limpa a subcategoria —
 * senão sobra um par impossível, como Bebidas › Vibrador.
 *
 * O que vai para o banco é sempre o id mais específico escolhido: a
 * subcategoria quando existe, senão a categoria.
 */
export function CampoCategoria({
  categorias,
  valor,
  onChange,
  onCriar,
  podeCriar,
}: {
  categorias: LocalCategory[];
  /** Id da categoria ou da subcategoria selecionada. */
  valor: string;
  onChange: (categoriaId: string) => void;
  onCriar?: (paiId: string | null) => void;
  podeCriar: boolean;
}) {
  const ativas = useMemo(() => categorias.filter((c) => c.active), [categorias]);
  const raizes = useMemo(() => ativas.filter((c) => !c.parent_id), [ativas]);

  /* O valor guardado pode ser mãe ou filha; a tela precisa das duas partes. */
  const selecionada = ativas.find((c) => c.id === valor);
  const raizId = selecionada?.parent_id ?? selecionada?.id ?? "";
  const filhaId = selecionada?.parent_id ? selecionada.id : "";
  const filhas = useMemo(
    () => (raizId ? ativas.filter((c) => c.parent_id === raizId) : []),
    [ativas, raizId],
  );

  const trocarRaiz = (novoId: string) => {
    // Trocar a categoria desfaz a subcategoria: a antiga não pertence à nova.
    onChange(novoId);
  };

  const trocarFilha = (novoId: string) => {
    onChange(novoId || raizId);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Selecao
          id="pcat"
          rotulo="Categoria"
          valor={raizId}
          onChange={trocarRaiz}
          placeholder="Escolha a categoria"
          opcoes={raizes.map((c) => ({
            valor: c.id,
            rotulo: c.name,
            cor: c.color || "var(--linha-outro)",
            detalhe: `${c.product_count}`,
          }))}
        />
        {podeCriar && onCriar && (
          <button
            type="button"
            onClick={() => onCriar(null)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <Plus className="h-3 w-3" aria-hidden /> Nova categoria
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <Selecao
            id="psub"
            rotulo="Subcategoria"
            valor={filhaId}
            onChange={trocarFilha}
            disabled={!raizId}
            placeholder={raizId ? "Opcional" : "Escolha a categoria antes"}
            opcoes={[
              { valor: "", rotulo: "— nenhuma —" },
              ...filhas.map((c) => ({
                valor: c.id,
                rotulo: c.name,
                detalhe: `${c.product_count}`,
              })),
            ]}
            className="flex-1"
          />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {podeCriar && onCriar && raizId && (
            <button
              type="button"
              onClick={() => onCriar(raizId)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <Plus className="h-3 w-3" aria-hidden /> Nova subcategoria
            </button>
          )}
          <Ajuda>
            A subcategoria é opcional. Escolher uma preenche as duas: o produto guarda o texto das
            duas para o histórico, e a cor vem sempre da categoria.
          </Ajuda>
        </div>
      </div>
    </div>
  );
}

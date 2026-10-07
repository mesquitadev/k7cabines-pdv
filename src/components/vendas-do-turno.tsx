import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Rotulo } from "@/components/placa";
import type { LocalVendasDoTurno } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * O que saiu no turno, do total para o item.
 *
 * A conferência do dinheiro responde "bate?". Isto responde "do que veio" — e
 * o gerente faz as duas perguntas no mesmo momento, então as duas ficam na
 * mesma tela.
 *
 * Categoria e subcategoria abrem e fecham porque o interesse muda: às vezes
 * basta saber que Bebidas fez R$ 540, às vezes é preciso ver que foi a Brahma.
 */

const fmt = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function VendasDoTurno({ vendas }: { vendas: LocalVendasDoTurno }) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const alternar = (chave: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });

  if (vendas.categorias.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhuma venda registrada neste turno ainda.
      </p>
    );
  }

  return (
    <div className="painel overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
        <Rotulo>O que foi vendido</Rotulo>
        <span className="num text-sm">
          {vendas.unidades} item(ns) · <strong>{fmt(vendas.total_cents)}</strong>
        </span>
      </div>

      {vendas.categorias.map((c) => {
        const chaveCat = c.categoria;
        const catAberta = abertas.has(chaveCat);
        return (
          <div key={chaveCat} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => alternar(chaveCat)}
              aria-expanded={catAberta}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
            >
              {catAberta ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 font-semibold">{c.categoria}</span>
              <span className="num shrink-0 text-xs text-muted-foreground">{c.unidades} un</span>
              <span className="num w-28 shrink-0 text-right tabular-nums">
                {fmt(c.total_cents)}
              </span>
            </button>

            {catAberta &&
              c.subcategorias.map((s) => {
                const chaveSub = `${chaveCat}/${s.subcategoria}`;
                const subAberta = abertas.has(chaveSub);
                // Categoria sem subcategoria não ganha um nível a mais: os
                // produtos aparecem direto, sem grupo de nome vazio.
                const semNome = !s.subcategoria.trim();
                return (
                  <div key={chaveSub}>
                    {!semNome && (
                      <button
                        type="button"
                        onClick={() => alternar(chaveSub)}
                        aria-expanded={subAberta}
                        className="flex w-full items-center gap-2 border-t border-border/60 py-2 pl-10 pr-4 text-left transition-colors hover:bg-accent/30"
                      >
                        {subAberta ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 text-sm">{s.subcategoria}</span>
                        <span className="num shrink-0 text-xs text-muted-foreground">
                          {s.unidades} un
                        </span>
                        <span className="num w-28 shrink-0 text-right text-sm tabular-nums">
                          {fmt(s.total_cents)}
                        </span>
                      </button>
                    )}

                    {(semNome || subAberta) &&
                      s.produtos.map((p) => (
                        <div
                          key={`${chaveSub}/${p.produto}`}
                          className={cn(
                            "flex items-center gap-2 border-t border-border/40 py-1.5 pr-4 text-sm",
                            semNome ? "pl-10" : "pl-16",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {p.produto}
                          </span>
                          <span className="num shrink-0 text-xs text-muted-foreground">
                            {p.unidades} un
                          </span>
                          <span className="num w-28 shrink-0 text-right tabular-nums">
                            {fmt(p.total_cents)}
                          </span>
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

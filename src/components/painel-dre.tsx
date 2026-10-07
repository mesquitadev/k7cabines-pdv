import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { Rotulo } from "@/components/placa";
import { Ajuda } from "@/components/ajuda";
import type { LocalDre } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * Demonstrativo de resultado do período.
 *
 * Não é um DRE contábil e a tela diz isso: a loja não lança despesa nem
 * aluguel, então a conta para no lucro bruto. O que está aqui é medido, não
 * estimado — receita, desconto, devolução e custo saem de linhas gravadas.
 */

const fmt = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

/** Linha da cascata: rótulo à esquerda, valor à direita, como num extrato. */
function Linha({
  rotulo,
  valor,
  ajuda,
  sinal,
  destaque,
  resultado,
}: {
  rotulo: string;
  valor: number;
  ajuda?: string;
  /** "menos" desenha o valor como dedução. */
  sinal?: "menos";
  destaque?: boolean;
  resultado?: boolean;
}) {
  const cor = resultado
    ? valor >= 0
      ? "var(--success)"
      : "var(--destructive)"
    : sinal === "menos"
      ? "var(--muted-foreground)"
      : "var(--foreground)";
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 px-4 py-2.5",
        destaque && "border-t border-border bg-secondary/40",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-sm", destaque && "font-semibold")}>
        {rotulo}
        {ajuda && <Ajuda>{ajuda}</Ajuda>}
      </span>
      <span
        className={cn("num tabular-nums", destaque ? "text-xl font-bold" : "text-sm")}
        style={{ color: cor }}
      >
        {sinal === "menos" && valor > 0 ? "− " : ""}
        {fmt(Math.abs(valor))}
      </span>
    </div>
  );
}

function Indicador({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="placa p-4">
      <Rotulo className="block">{rotulo}</Rotulo>
      <div className="num mt-1 text-2xl font-bold tabular-nums">{valor}</div>
      {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

/**
 * `mostrarLucro`: só gestor vê lucro bruto, CMV e margem. Atendente enxerga
 * receita e meios de pagamento, que é o que precisa para conferir o caixa.
 */
export function PainelDre({ dre, mostrarLucro = true }: { dre: LocalDre; mostrarLucro?: boolean }) {
  const semVenda = dre.vendas === 0;
  const recebido = dre.dinheiro_cents + dre.cartao_cents + dre.pix_cents;
  const maiorDia = dre.por_dia.reduce(
    (melhor, d) =>
      !melhor ||
      (mostrarLucro ? d.lucro_cents > melhor.lucro_cents : d.receita_cents > melhor.receita_cents)
        ? d
        : melhor,
    null as LocalDre["por_dia"][number] | null,
  );

  if (semVenda) {
    return (
      <div className="placa p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma venda no período escolhido. Ajuste as datas acima.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Receita líquida"
          valor={fmt(dre.receita_liquida_cents)}
          nota={`${dre.vendas} venda(s) · ${dre.unidades} item(ns)`}
        />
        {mostrarLucro && (
          <Indicador
            rotulo="Lucro bruto"
            valor={fmt(dre.lucro_bruto_cents)}
            nota={`Margem de ${pct(dre.margem_percentual)}`}
          />
        )}
        <Indicador
          rotulo="Ticket médio"
          valor={fmt(dre.ticket_medio_cents)}
          nota="Receita líquida ÷ vendas"
        />
        <Indicador
          rotulo="Melhor dia"
          valor={maiorDia ? fmt(mostrarLucro ? maiorDia.lucro_cents : maiorDia.receita_cents) : "—"}
          nota={
            maiorDia
              ? new Date(`${maiorDia.dia}T00:00:00`).toLocaleDateString("pt-BR")
              : undefined
          }
        />
      </div>

      {/* O aviso vem antes do número: um CMV incompleto lido como completo faz
          o gerente acreditar numa margem que ele não tem. */}
      {mostrarLucro && dre.itens_sem_custo > 0 && (
        <div
          className="flex items-start gap-2.5 border p-3"
          style={{
            borderColor: "var(--warning)",
            background: "color-mix(in oklab, var(--warning) 12%, transparent)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: "var(--warning)" }}
            aria-hidden
          />
          <p className="text-sm leading-relaxed">
            <strong>
              {dre.itens_sem_custo} de {dre.itens_total} itens
            </strong>{" "}
            foram vendidos sem custo registrado, então o CMV está subestimado e a margem, alta
            demais. Isso acontece com vendas anteriores ao controle de custo e com produtos
            cadastrados sem custo de compra — informe o custo na entrada de estoque para as
            próximas fecharem certo.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="painel overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <Rotulo>Resultado do período</Rotulo>
          </div>
          <Linha
            rotulo="Receita bruta"
            valor={dre.receita_bruta_cents}
            ajuda="Soma dos itens vendidos, pelo preço de tabela, antes de desconto."
          />
          <Linha rotulo="Descontos concedidos" valor={dre.descontos_cents} sinal="menos" />
          <Linha
            rotulo="Devoluções"
            valor={dre.devolucoes_cents}
            sinal="menos"
            ajuda="Contadas pela data do estorno, que é quando o dinheiro sai, e não pela data da venda."
          />
          <Linha rotulo="Receita líquida" valor={dre.receita_liquida_cents} destaque />
          {mostrarLucro && (
            <>
              <Linha
                rotulo="Custo das mercadorias (CMV)"
                valor={dre.cmv_cents}
                sinal="menos"
                ajuda="Pelo custo congelado no momento de cada venda, não pelo custo de hoje: o custo muda a cada compra."
              />
              <Linha rotulo="Lucro bruto" valor={dre.lucro_bruto_cents} destaque resultado />
              <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                A conta para aqui: o sistema não registra aluguel, salário nem outras despesas,
                então este não é o lucro final da loja.
              </div>
            </>
          )}
        </section>

        <div className="space-y-4">
          <section className="painel overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <Rotulo>Como o dinheiro entrou</Rotulo>
            </div>
            {/* PIX deixou de ser meio de pagamento (é cobrado na maquininha);
                a linha só aparece em período que tenha venda antiga com PIX. */}
            {[
              { nome: "Dinheiro", valor: dre.dinheiro_cents },
              { nome: "Maquininha", valor: dre.cartao_cents },
              ...(dre.pix_cents > 0 ? [{ nome: "PIX", valor: dre.pix_cents }] : []),
            ].map((m) => (
              <div key={m.nome} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{m.nome}</span>
                  <span className="num text-sm tabular-nums">
                    {fmt(m.valor)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {pct(recebido ? (m.valor / recebido) * 100 : 0)}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 bg-secondary">
                  <div
                    className="h-full"
                    style={{
                      width: `${recebido ? (m.valor / recebido) * 100 : 0}%`,
                      background: "var(--primary)",
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Dinheiro já descontado o troco de {fmt(dre.troco_cents)}. Só o dinheiro passa pela
              gaveta e entra na conferência do turno.
            </div>
          </section>

          <section className="painel overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <Rotulo>Resultado por categoria</Rotulo>
            </div>
            <div className="max-h-72 divide-y divide-border overflow-y-auto">
              {dre.por_categoria.map((c) => (
                <div key={c.categoria} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {c.categoria}
                    </span>
                    <span className="num text-sm tabular-nums">{fmt(c.receita_cents)}</span>
                  </div>
                  <div className="rotulo num mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                    <span>{c.unidades} un</span>
                    {mostrarLucro && <span>custo {fmt(c.cmv_cents)}</span>}
                    {mostrarLucro && (
                    <span
                      className="inline-flex items-center gap-1"
                      style={{
                        color:
                          c.lucro_cents >= 0 ? "var(--success)" : "var(--destructive)",
                      }}
                    >
                      {c.lucro_cents >= 0 ? (
                        <TrendingUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <TrendingDown className="h-3 w-3" aria-hidden />
                      )}
                      {fmt(c.lucro_cents)} · {pct(c.margem_percentual)}
                    </span>
                    )}
                    <span>{pct(c.participacao_percentual)} da receita</span>
                    {mostrarLucro && c.itens_sem_custo > 0 && (
                      <span style={{ color: "var(--warning)" }}>
                        {c.itens_sem_custo} sem custo
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {dre.por_dia.length > 1 && (
        <section className="painel overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <Rotulo>Dia a dia</Rotulo>
          </div>
          <div className="max-h-64 divide-y divide-border overflow-y-auto">
            {dre.por_dia.map((d) => {
              const teto = Math.max(...dre.por_dia.map((x) => Math.abs(x.receita_cents)), 1);
              return (
                <div key={d.dia} className="flex items-center gap-3 px-4 py-2">
                  <span className="num w-20 shrink-0 text-xs text-muted-foreground">
                    {new Date(`${d.dia}T00:00:00`).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </span>
                  <div className="h-4 flex-1 bg-secondary">
                    <div
                      className="h-full"
                      style={{
                        width: `${(Math.abs(d.receita_cents) / teto) * 100}%`,
                        background: "color-mix(in oklab, var(--primary) 70%, transparent)",
                      }}
                    />
                  </div>
                  <span className="num w-24 shrink-0 text-right text-xs tabular-nums">
                    {fmt(d.receita_cents)}
                  </span>
                  {mostrarLucro && (
                  <span
                    className="num w-24 shrink-0 text-right text-xs tabular-nums"
                    style={{
                      color: d.lucro_cents >= 0 ? "var(--success)" : "var(--destructive)",
                    }}
                  >
                    {fmt(d.lucro_cents)}
                  </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Barra e primeiro valor: receita.{mostrarLucro && " Segundo valor: lucro bruto do dia."}
          </div>
        </section>
      )}
    </div>
  );
}

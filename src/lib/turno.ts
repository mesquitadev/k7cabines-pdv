import type { CashSession } from "@/lib/desktop";

/**
 * Há quantos dias o turno está aberto.
 *
 * A regra da loja é abrir de manhã e fechar à noite. Quando alguém esquece de
 * fechar, o dia seguinte inteiro cai na conferência de ontem: o esperado da
 * gaveta soma dois dias, e a diferença apurada no fechamento deixa de significar
 * qualquer coisa. O sistema não fecha sozinho — fechar é contar dinheiro, e
 * ninguém pode contar por você — mas precisa avisar.
 */
export function diasEmAberto(sessao: CashSession | null): number {
  if (!sessao) return 0;
  const abertura = new Date(sessao.opened_at);
  const diaDaAbertura = new Date(
    abertura.getFullYear(),
    abertura.getMonth(),
    abertura.getDate(),
  );
  const hoje = new Date();
  const diaDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.max(
    0,
    Math.round((diaDeHoje.getTime() - diaDaAbertura.getTime()) / 86_400_000),
  );
}

export function avisoDeTurnoAntigo(sessao: CashSession | null): string | null {
  const dias = diasEmAberto(sessao);
  if (dias < 1) return null;
  const quando = dias === 1 ? "ontem" : `há ${dias} dias`;
  return `Este turno foi aberto ${quando} e não foi fechado. As vendas de hoje estão entrando na conferência dele, então a diferença apurada no fechamento vai misturar os dias. Feche o turno e abra outro.`;
}

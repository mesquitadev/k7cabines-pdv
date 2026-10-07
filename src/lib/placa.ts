/**
 * Vocabulário da Placa de Embarque.
 *
 * Cor de linha é o único código cromático do sistema e vale igual em todas as
 * telas: catálogo, estoque e relatórios. Status de validade herda o vocabulário
 * de status de serviço da sinalização — no prazo, atrasado, cancelado.
 */

export type Linha = "pulseira" | "bebida" | "erotico" | "outro";

const semAcento = (valor: string) =>
  valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function linhaDe(categoria: string): Linha {
  const c = semAcento(categoria);
  if (c.includes("pulseira")) return "pulseira";
  if (c.includes("erotic")) return "erotico";
  if (c.includes("bebida")) return "bebida";
  return "outro";
}

/** Variável CSS da linha, para aplicar via style={{ "--linha": ... }}. */
export const corDaLinha: Record<Linha, string> = {
  pulseira: "var(--linha-pulseira)",
  bebida: "var(--linha-bebida)",
  erotico: "var(--linha-erotico)",
  outro: "var(--linha-outro)",
};

export const nomeDaLinha: Record<Linha, string> = {
  pulseira: "Pulseiras",
  bebida: "Bebidas",
  erotico: "Eróticos",
  outro: "Outros",
};

export type StatusValidade = "sem-controle" | "no-prazo" | "vencendo" | "vencido";

export interface Validade {
  status: StatusValidade;
  dias: number | null;
  rotulo: string;
  data: string | null;
}

const DIA = 86_400_000;

export function diasAte(iso: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${iso}T00:00:00`);
  return Math.floor((alvo.getTime() - hoje.getTime()) / DIA);
}

/** Um produto sem lote não tem controle de validade (caso das Pulseiras). */
export function validadeDe(expiryISO: string | null | undefined): Validade {
  if (!expiryISO) {
    return { status: "sem-controle", dias: null, rotulo: "Sem validade", data: null };
  }
  const dias = diasAte(expiryISO);
  if (dias < 0) return { status: "vencido", dias, rotulo: "Vencido", data: expiryISO };
  if (dias <= 45) {
    return {
      status: "vencendo",
      dias,
      rotulo: dias === 0 ? "Vence hoje" : `Vence em ${dias}d`,
      data: expiryISO,
    };
  }
  return { status: "no-prazo", dias, rotulo: "No prazo", data: expiryISO };
}

/** Cor e forma do status. A cor nunca é o único sinal: o rótulo sempre acompanha. */
export const estiloValidade: Record<StatusValidade, { cor: string; fundo: string }> = {
  "sem-controle": { cor: "var(--muted-foreground)", fundo: "transparent" },
  "no-prazo": { cor: "var(--success)", fundo: "color-mix(in oklab, var(--success) 16%, transparent)" },
  vencendo: { cor: "var(--warning)", fundo: "color-mix(in oklab, var(--warning) 20%, transparent)" },
  vencido: { cor: "var(--destructive)", fundo: "color-mix(in oklab, var(--destructive) 22%, transparent)" },
};

export const ESTOQUE_BAIXO = 5;

export const dinheiro = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dataCurta = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
};

/** Prioridade do balcão: Pulseiras primeiro, Eróticos por último. */
export function prioridadeCategoria(categoria: string): number {
  const linha = linhaDe(categoria);
  if (linha === "pulseira") return 0;
  if (linha === "erotico") return 2;
  return 1;
}

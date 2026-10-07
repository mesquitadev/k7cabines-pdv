/**
 * Espelho no front da validação de SKU e GTIN que vive em
 * `src-tauri/src/identificacao.rs`.
 *
 * O Rust continua sendo a autoridade — nada aqui dispensa a validação de lá.
 * Isto existe só para o operador ver o erro enquanto o leitor ainda está na
 * mão, em vez de descobrir depois de salvar.
 */

/** Tipos de GTIN por comprimento. Todos usam o mesmo dígito verificador GS1. */
const TIPOS: Record<number, string> = {
  8: "EAN-8",
  12: "UPC-A",
  13: "EAN-13",
  14: "DUN-14",
};

export const UNIDADES = [
  { valor: "UN", nome: "Unidade (UN)" },
  { valor: "CX", nome: "Caixa (CX)" },
  { valor: "PC", nome: "Pacote (PC)" },
  { valor: "PAR", nome: "Par (PAR)" },
  { valor: "ML", nome: "Mililitro (ML)" },
  { valor: "G", nome: "Grama (G)" },
];

export type ChecagemGtin =
  | { estado: "vazio" }
  | { estado: "ok"; digitos: string; tipo: string }
  | { estado: "erro"; mensagem: string };

/** Dígito verificador GS1: módulo 10, pesos 3 e 1 a partir da direita. */
function digitoConfere(digitos: string): boolean {
  const v = [...digitos].map(Number);
  const informado = v[v.length - 1];
  const soma = v
    .slice(0, -1)
    .reverse()
    .reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === informado;
}

export function checarGtin(bruto: string): ChecagemGtin {
  const digitos = bruto.replace(/[\s.\-]/g, "");
  if (!digitos) return { estado: "vazio" };
  if (!/^\d+$/.test(digitos)) {
    return { estado: "erro", mensagem: "O código de barras aceita apenas números." };
  }
  const tipo = TIPOS[digitos.length];
  if (!tipo) {
    return {
      estado: "erro",
      mensagem: `${digitos.length} dígitos não formam um código válido: use 8, 12, 13 ou 14.`,
    };
  }
  if (!digitoConfere(digitos)) {
    return {
      estado: "erro",
      mensagem: "O dígito verificador não confere. Leia a etiqueta de novo.",
    };
  }
  return { estado: "ok", digitos, tipo };
}

/** Normaliza como o Rust: maiúsculas, espaço vira hífen. */
export function normalizarSku(bruto: string): string {
  return bruto.trim().toUpperCase().replace(/\s+/g, "-");
}

export function checarSku(bruto: string): string | null {
  const s = normalizarSku(bruto);
  if (s.length < 2) return "O SKU precisa de pelo menos 2 caracteres.";
  if (s.length > 24) return "O SKU pode ter no máximo 24 caracteres.";
  if (!/^[A-Z0-9\-._]+$/.test(s)) {
    return "O SKU aceita letras, números, hífen, ponto e sublinhado.";
  }
  return null;
}

/**
 * Sugere um SKU legível a partir de categoria e nome, evitando os que já
 * existem. Espelha `sugere_sku` do Rust, que não garante unicidade.
 */
export function sugerirSku(categoria: string, nome: string, usados: Set<string>): string {
  const pedaco = (t: string, n: number) =>
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, n);
  const cat = pedaco(categoria, 3);
  const nom = pedaco(nome, 6);
  const base = [cat, nom].filter(Boolean).join("-") || "PROD";
  for (let i = 1; i <= 999; i += 1) {
    const tentativa = `${base}-${String(i).padStart(3, "0")}`;
    if (!usados.has(tentativa)) return tentativa;
  }
  return base;
}

/**
 * Espelho no front da validação de CNPJ/CPF de `src-tauri/src/suppliers.rs`.
 * O Rust continua sendo a autoridade; isto existe para o erro aparecer
 * enquanto se digita.
 */

const soDigitos = (t: string) => t.replace(/\D/g, "");

function cpfValido(d: string): boolean {
  const n = [...d].map(Number);
  if (n.every((x) => x === n[0])) return false;
  for (const [tam, peso] of [
    [9, 10],
    [10, 11],
  ] as const) {
    const soma = n.slice(0, tam).reduce((s, v, i) => s + v * (peso - i), 0);
    const resto = soma % 11;
    if (n[tam] !== (resto < 2 ? 0 : 11 - resto)) return false;
  }
  return true;
}

function cnpjValido(d: string): boolean {
  const n = [...d].map(Number);
  if (n.every((x) => x === n[0])) return false;
  for (const tam of [12, 13]) {
    const soma = n
      .slice(0, tam)
      .reverse()
      .reduce((s, v, i) => s + v * (2 + (i % 8)), 0);
    const resto = soma % 11;
    if (n[tam] !== (resto < 2 ? 0 : 11 - resto)) return false;
  }
  return true;
}

export type ChecagemDocumento =
  | { estado: "vazio" }
  | { estado: "ok"; digitos: string; tipo: "CPF" | "CNPJ" }
  | { estado: "erro"; mensagem: string };

export function checarDocumento(bruto: string): ChecagemDocumento {
  const d = soDigitos(bruto);
  if (!d) return { estado: "vazio" };
  if (d.length === 11) {
    return cpfValido(d)
      ? { estado: "ok", digitos: d, tipo: "CPF" }
      : { estado: "erro", mensagem: "CPF inválido: confira os números." };
  }
  if (d.length === 14) {
    return cnpjValido(d)
      ? { estado: "ok", digitos: d, tipo: "CNPJ" }
      : { estado: "erro", mensagem: "CNPJ inválido: confira os números." };
  }
  return {
    estado: "erro",
    mensagem: `${d.length} dígitos: use 11 para CPF ou 14 para CNPJ.`,
  };
}

/** Formata para leitura: 11.222.333/0001-81 ou 529.982.247-25. */
export function formatarDocumento(bruto: string | null): string {
  if (!bruto) return "";
  const d = soDigitos(bruto);
  if (d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (d.length === 11) {
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return d;
}

/** Telefone brasileiro: (21) 98888-7777. */
export function formatarTelefone(bruto: string): string {
  const d = soDigitos(bruto).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

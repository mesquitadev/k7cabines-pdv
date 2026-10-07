import { desktop, desktopToken, isDesktop } from "@/lib/desktop";

/**
 * Tamanho da letra da interface, em percentual sobre a base do sistema.
 *
 * Aplicado na raiz do documento: subir a raiz escala tudo junto — rótulo,
 * campo, tabela, preço — em vez de fazer partes crescerem soltas e o layout
 * desmontar.
 *
 * O valor fica em `localStorage` além do banco porque ele precisa valer já na
 * primeira pintura, antes de qualquer chamada ao Rust: sem isso a tela abre
 * pequena e dá um salto quando o parâmetro chega.
 */
const CHAVE = "pdv:fonte-interface";
const BASE_PX = 16;
const PADRAO = 115;

export function aplicarFonte(percentual: number): void {
  const seguro = Math.min(150, Math.max(85, Math.round(percentual)));
  document.documentElement.style.fontSize = `${(BASE_PX * seguro) / 100}px`;
  try {
    localStorage.setItem(CHAVE, String(seguro));
  } catch {
    /* janela privada: vale só nesta sessão */
  }
}

/** Aplica o último valor conhecido, antes de falar com o Rust. */
export function aplicarFonteSalva(): void {
  try {
    const bruto = localStorage.getItem(CHAVE);
    aplicarFonte(bruto ? parseInt(bruto, 10) || PADRAO : PADRAO);
  } catch {
    aplicarFonte(PADRAO);
  }
}

/** Lê o parâmetro do banco e aplica, corrigindo o palpite do localStorage. */
export async function sincronizarFonte(): Promise<void> {
  if (!isDesktop()) return;
  const token = desktopToken();
  if (!token) return;
  try {
    const params = await desktop.listParams(token);
    const fonte = params.find((p) => p.key === "interface.fonte");
    if (fonte) aplicarFonte(parseInt(fonte.value, 10) || PADRAO);
  } catch {
    /* mantém o valor salvo */
  }
}

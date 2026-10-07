import { toast } from "sonner";
import { desktop, desktopToken, isDesktop } from "@/lib/desktop";

/**
 * Imprime o cupom pela impressora configurada, caindo no diálogo do navegador
 * quando não há uma.
 *
 * O caminho preferido manda só o id da venda: o Rust relê o cupom do banco e
 * monta os bytes. Aceitar o cupom pronto da tela deixaria o papel dizer um
 * total diferente do que está gravado.
 *
 * `window.print()` continua existindo como saída de emergência — no modo
 * "navegador", ou quando a impressora não responde no meio do movimento. Numa
 * fila, um cupom pelo diálogo é melhor que nenhum.
 */
export async function imprimirCupom(saleId: string | null): Promise<void> {
  if (!isDesktop() || !saleId) {
    setTimeout(() => window.print(), 250);
    return;
  }
  const token = desktopToken();
  if (!token) {
    setTimeout(() => window.print(), 250);
    return;
  }
  try {
    await desktop.printSaleReceipt(token, saleId);
  } catch (erro) {
    const mensagem = typeof erro === "string" ? erro : "";
    // O modo navegador não é falha: é a configuração pedindo o diálogo.
    if (!mensagem.includes("navegador")) {
      toast.error(
        mensagem
          ? `Impressora: ${mensagem}. Abrindo o diálogo do sistema.`
          : "A impressora não respondeu. Abrindo o diálogo do sistema.",
      );
    }
    setTimeout(() => window.print(), 250);
  }
}

/**
 * Imprime a ficha da venda, se ela tiver criado uma.
 *
 * Devolve `true` quando saiu papel. Venda sem item em crédito não tem ficha e
 * não é erro — por isso o retorno é booleano em vez de exceção.
 */
export async function imprimirFicha(saleId: string): Promise<boolean> {
  if (!isDesktop()) return false;
  const token = desktopToken();
  if (!token) return false;
  try {
    return await desktop.printCreditVoucher(token, saleId);
  } catch (erro) {
    const mensagem = typeof erro === "string" ? erro : "";
    if (!mensagem.includes("navegador")) {
      toast.error(
        mensagem
          ? `Ficha não impressa: ${mensagem}`
          : "A ficha não foi impressa. Use o botão de fichas para reimprimir.",
      );
    }
    return false;
  }
}

/** A loja quer que o cupom saia sozinho ao emitir? */
export async function imprimeCupomSozinho(): Promise<boolean> {
  if (!isDesktop()) return true;
  const token = desktopToken();
  if (!token) return true;
  try {
    return (await desktop.getPrinterSettings(token)).auto_print_sale;
  } catch {
    // Falha ao ler a configuração não pode virar cupom que não sai.
    return true;
  }
}

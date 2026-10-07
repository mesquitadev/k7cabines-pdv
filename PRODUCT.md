# K7 Cabines — PDV

Ponto de venda desktop, **100% offline**, para a unidade K7 Cabines Pavuna (Rio de Janeiro).
Aplicativo Tauri 2 (Rust + React) com SQLite embarcado como única fonte oficial dos dados.

## Platform

`web` — renderizado em WebView dentro de aplicativo desktop (Tauri). Não é site, não é mobile.
Janela maximizada, um computador principal por unidade.

## Usuários e situação

Três papéis, todos operando o mesmo computador atrás do balcão:

- **Atendente** — opera o caixa. É quem sofre a fila. Job: registrar a venda, receber, dar troco e entregar o cupom com o número de retirada. Sucesso é a fila andar sem erro de dinheiro.
- **Supervisor** — atendente + estoque (entrada, saída, lotes). Não exclui produto.
- **Gerente** — tudo, incluindo usuários, permissões, configuração do cupom, backup e restauração.

**Cena de uso real:** balcão de estabelecimento noturno, cliente esperando em pé, operador em pé, iluminação variável, pressa. Entrada por **toque e por mouse/teclado** — o desenho precisa servir aos dois.

## O que o produto torna possível

- **Venda transacional local:** preço e estoque relidos do banco (nunca do que a tela mandou), total recalculado, pagamento em dinheiro e/ou maquininha, troco, numeração do pedido e baixa de estoque — tudo numa transação atômica que confirma ou reverte por inteiro.
- **Estoque com shelf life por lote:** entrada com data de validade, saída em **FEFO** (vence primeiro, sai primeiro), descarte de lote vencido, alerta de validade próxima ao abrir o sistema.
- **Cupom de retirada:** o número do pedido em cinco dígitos é o elemento central — é por ele que o cliente retira na chapelaria.
- **Relatórios e fechamento:** vendas do período, comparativo hora a hora, quebra por categoria, alterações de estoque e um texto de fechamento pronto para enviar no WhatsApp.
- **Backup local** automático diário e manual, com restauração validada.

## Prioridades confirmadas para o caixa (todas)

1. Achar o produto em um segundo — busca dominante, leitor de código de barras, mais vendidos à mão.
2. Zero erro no pagamento — troco inequívoco, impossível confundir dinheiro e maquininha.
3. Ver validade e estoque na hora, no próprio cartão do produto.
4. Reimprimir e corrigir rápido — a última venda sempre ao alcance.

## Regras de negócio duráveis

- **Pulseira K7: no máximo uma por venda.** É o produto de entrada da casa.
- **Toda categoria exige validade por lote, exceto Pulseiras.**
- Numeração do pedido é **global e cicla de 0 a 999**, começando em 0.
- Dinheiro sempre em **centavos inteiros**; nunca ponto flutuante.
- Troco só existe sobre a parte paga em dinheiro.
- Autorização é revalidada no Rust; a interface nunca decide permissão.
- Excluir venda exige motivo e devolve o estoque.
- Exclusão de produto é lógica, para não quebrar o histórico de vendas.

## Terminologia da casa

**Chapelaria** (número de retirada do pedido) · **Pulseira K7** · **Maquininha** (cartão) · **Fechamento** (resumo do turno) · **Lote** (estoque com uma validade) · **Estq** (abreviação usada no catálogo).

Categorias reais: Bebidas, Produtos eróticos, Pulseiras. Subcategorias por marca (Brahma, Heineken, Antarctica, Skol Beats, Red Bull, Refrigerante, Água C/ Gás, Água S/ Gás).

## Restrições duráveis

- **Ausência de internet não é estado de erro.** Nenhuma tela pode sugerir "sincronizando", "offline" ou "reconectando".
- Sem Supabase, API, servidor local ou SGBD separado.
- Regras críticas, autorização e transações vivem em Rust; React é apenas interface.
- A arquitetura precisa permitir sincronização futura, mas ela não existe hoje.
- Impressão é controlada pelo aplicativo.
- O banco não é criptografado em repouso — não afirmar que é.

## Estado de acessibilidade

Operação sob pressa, iluminação variável e possivelmente por pessoas diferentes a cada turno. Alvos de toque generosos, contraste alto em números de dinheiro e validade, e nenhuma informação crítica transmitida só por cor.

## Stack

Definida e em produção: Tauri 2, Rust, SQLite, React, TanStack Router, Tailwind v4, shadcn/ui, lucide-react, sonner. Build desktop por `vite.desktop.config.ts`. Não substituir.

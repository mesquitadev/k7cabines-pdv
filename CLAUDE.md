# K7 Cabines — memória de desenvolvimento

Atualizado em 02/09/2026. Este arquivo é o handoff técnico para continuar a implementação no Claude Code.

## Objetivo atual

Transformar o sistema existente em uma aplicação desktop multiplataforma, 100% offline, usando Tauri 2, Rust, React e SQLite embarcado.

Decisões fechadas com o cliente:

- Um computador principal por unidade.
- SQLite local é a única fonte oficial dos dados.
- Regras críticas, autorização e transações ficam em Rust.
- React é apenas interface; não deve decidir regras de negócio.
- Impressão é controlada pelo aplicativo desktop.
- Backup automático e manual será local.
- Atualizações serão distribuídas por instaladores assinados.
- A arquitetura deve permitir sincronização futura, mas sincronização não será implementada agora.
- A versão desktop não pode depender de Supabase, API, servidor local, internet ou instalação separada de SGBD.

Não voltar a produzir documentação comercial ou PDF neste momento. A prioridade solicitada é desenvolvimento.

## Arquitetura alvo

```text
React/WebView
    |
    | comandos Tauri tipados
    v
Rust (autenticação, permissões, vendas, estoque, impressão, backup)
    |
    v
SQLite embarcado (arquivo no app_data_dir)
```

- Caminho do banco em runtime: `app_data_dir/k7-cabines.sqlite3`.
- Dinheiro deve permanecer como inteiros em centavos.
- Escritas que envolvem venda, estoque, auditoria e numeração devem ser atômicas.
- O banco ativa foreign keys, WAL, busy timeout e migrations; conferir `src-tauri/src/db.rs`.
- `sync_outbox` existe apenas como preparação estrutural. Não criar workers nem comunicação externa agora.

## O que já foi implementado

### Estrutura Tauri/Rust

- `src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`, capability e ícone.
- Inicialização do SQLite em `src-tauri/src/lib.rs`.
- Migration inicial em `src-tauri/migrations/001_initial.sql`.
- Schema local para usuários, permissões, produtos, lotes, vendas, itens, movimentos de estoque, configurações de ticket, auditoria e outbox futura.
- Erros de domínio em `src-tauri/src/error.rs`.
- Estado da aplicação e sessões opacas somente em memória em `src-tauri/src/state.rs`.

### Autenticação local

- Primeiro gerente criado atomicamente.
- Senha armazenada com Argon2; senha nunca é persistida no frontend.
- Login, sessão local, sessão atual e logout.
- O frontend guarda em `sessionStorage` somente o token opaco da sessão do processo.
- Após reiniciar o aplicativo, o usuário deve autenticar novamente.

### Produtos

- Listagem local autenticada.
- Criação local protegida por permissão, com validação, preço em centavos, código único e evento de auditoria.
- Ainda faltam edição, inativação/exclusão lógica, entrada/saída de estoque e lotes.

### Estoque local

- `src-tauri/src/stock.rs`: `update_product`, `delete_product` (lógica), `add_stock`, `remove_stock`, `delete_batch`, `list_batches`.
- Validade obrigatória por lote em toda categoria, exceto Pulseiras (`requires_expiry`).
- Entrada com a mesma validade soma no lote existente; saída consome lotes em FEFO.
- Toda operação é transacional, exige permissão própria e grava movimento + auditoria.
- `src/routes/_app.produtos.tsx` usa `desktop.*` quando `isDesktop()`; a tela já está liberada no menu.

### Backup local

- `src-tauri/src/backup.rs`: `create`, `create_manual`, `list`, `validate`, `restore`, `run_automatic`.
- Cópia consistente com `VACUUM INTO` (nunca cópia bruta do arquivo com o banco aberto).
- Automático na abertura do app, no máximo um a cada 20h, retenção das 15 cópias mais recentes.
- Restauração valida integridade (`integrity_check`), versão de schema e presença das tabelas centrais antes de substituir; grava uma cópia `pre-restauracao` como salvaguarda e reabre o banco original se algo falhar.
- Interface em `src/components/backup-panel.tsx`, montada na tela de Usuários (gerente).

### Venda transacional local

- `src-tauri/src/sales.rs` com `finalize` e `find_by_client_sale_id`.
- Comandos `finalize_sale` e `sale_by_client_id`, expostos em `src/lib/desktop.ts`.
- Tudo em uma transação: permissão `pdv.use`, releitura de preço/estoque no banco, regra da Pulseira K7 (1 por venda), total recalculado em centavos, validação de dinheiro/cartão/troco, numeração por `business_counters` (sequencial por data local, começando em 1), venda + itens, baixa de estoque condicional, consumo FEFO de lotes com `sale_item_batches`, movimentos de estoque, auditoria e evento reservado em `sync_outbox`.
- Idempotência por `client_sale_id`: reenvio devolve o mesmo cupom sem baixar estoque de novo.
- `src/routes/_app.pdv.tsx` usa `desktop.*` quando `isDesktop()`; no desktop não usa `offline-sales.ts`, `fetchTicketSettings` remoto nem Supabase.
- Testes Rust: venda completa com FEFO, numeração sequencial, sem permissão, estoque insuficiente com rollback integral, pagamento insuficiente, preço vindo do banco, limite da Pulseira K7, idempotência e produto inativo.

### Ponte React/Tauri

- `src/lib/desktop.ts` contém tipos e chamadas `invoke`.
- `src/lib/auth-context.tsx` suporta sessão desktop local e preserva temporariamente o modo web legado.
- `src/routes/auth.tsx` suporta bootstrap/login local.
- `src/router.tsx` usa hash history no desktop.
- `src/desktop-main.tsx`, `index.html` e `vite.desktop.config.ts` formam o build SPA estático.
- O PWA é desativado em runtime desktop em `src/routes/__root.tsx`.

### Barreira contra rede no desktop

O `vite.desktop.config.ts` substitui no build desktop:

- `@tanstack/react-start` por `src/lib/desktop/react-start-shim.ts`.
- `@/lib/users.functions` por `src/lib/desktop/users-functions-shim.ts`.
- `@/integrations/supabase/client` por `src/lib/desktop/supabase-disabled.ts`.

A intenção é garantir que um fluxo legado não abra conexão remota. Operações ainda não migradas devem falhar claramente, nunca recorrer ao Supabase.

## Validações já concluídas

Antes da última alteração do HTML/barreira Supabase:

- `cargo test --manifest-path src-tauri/Cargo.toml`: 5 testes aprovados.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: aprovado.
- `./node_modules/.bin/tsc --noEmit`: aprovado.
- O build SPA desktop compilou, mas gerou `dist/desktop/desktop.html`; por isso a entrada foi alterada para `index.html` depois.

Testes Rust existentes cobrem migration, bootstrap único, senha correta/incorreta, criação de produto e rejeição sem permissão.

## Estado exato no momento do handoff

A última alteração criou `index.html`, removeu `desktop.html` e adicionou a barreira `supabase-disabled.ts`. Essa alteração **ainda não foi retestada**.

Primeiro execute:

```bash
./node_modules/.bin/tsc --noEmit
npm run desktop:web:build
test -f dist/desktop/index.html
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Depois valide o executável sem empacotador, se possível:

```bash
npx tauri build --debug --no-bundle
```

O `tauri.conf.json` já usa:

- `npm run desktop:web:dev` no desenvolvimento.
- `npm run desktop:web:build` na compilação.
- `../dist/desktop` como `frontendDist`.

## Estado em 04/09/2026

A paridade com o legado está completa e o produto passou dela. O que existe hoje,
todo em Rust/SQLite, com 124 testes e clippy limpo:

- Venda com dinheiro, maquininha e **PIX** combinados, **desconto** por permissão,
  numeração por data, FEFO, idempotência por `client_sale_id`.
- **Devolução** item a item, com estorno escolhido e reposição opcional ao estoque.
- Turno de caixa (o antigo "caixa"): abertura, sangria, suprimento e fechamento
  conferido.
- Estoque com lotes, validade, inventário, **variações criadas de dentro do
  produto pai**, cada uma com o próprio GTIN, como a GS1 exige.
- **SKU e GTIN validados** (dígito verificador GS1; EAN-8, UPC-A, EAN-13, DUN-14),
  unidade de medida e leitura por código de barras na venda.
- **Fornecedores** com CNPJ/CPF validado, vínculo no produto, fornecedor e custo
  gravados em cada entrada, custo médio ponderado e histórico de compras.
- **Perfis de acesso** editáveis, criados pelo usuário, com exceção por pessoa.
- **Impressão nativa ESC/POS**: escolha do dispositivo, papel, colunas, corte,
  gaveta, página de teste e `window.print()` só como saída de emergência.
- Backup local, template entre lojas, parâmetros, manual dentro do sistema.

### Decisões que valem a pena não reverter

- **Dinheiro é sempre inteiro em centavos**, inclusive nos campos: digitar `800`
  é R$ 8,00, como na maquininha.
- **A impressão manda só o id da venda.** O Rust relê o cupom do banco. Aceitar o
  cupom pronto da tela deixaria o papel dizer um total diferente do gravado.
- **A gaveta só abre em venda com dinheiro.**
- **Um vocabulário só**: "Turno", nunca "Caixa" para a mesma tela.
- **Migrations sempre em `BEGIN IMMEDIATE`/`COMMIT`.** A 011 saiu sem, aplicou o
  `ALTER` sem gravar a versão, e o app deixou de abrir.
- **Permissão exigida no código tem que existir no catálogo.** Há um teste que
  varre os `.rs` e falha se não existir — sem ele, a permissão fica impossível
  de conceder e o recurso some sem mensagem.
- **O papel é o padrão, não um teto.** Quem tem `users.manage` concede o que
  quiser como exceção; a regra fixa do legado que descartava permissões em
  silêncio foi removida de propósito.

## Próxima tarefa prioritária

A paridade com o legado está completa: caixa, estoque, relatórios, impressora, usuários e alerta de validade rodam apenas em SQLite. Backup local implementado.

Pendências, em ordem:

1. **Validar na interface.** Continua sendo o maior buraco: há 124 testes de Rust
   e nenhum de tela. Cada rodada de uso real apareceu defeito que teste de
   unidade não pegaria — o `h-` que travava a rolagem do select, o campo de EAN
   duplicado, permissões descartadas em silêncio.
2. **Assinar os instaladores.** O empacotamento funciona (`docs/empacotamento.md`,
   com `.app` gerado e aberto em 04/09). Falta o certificado de code signing do
   Windows, sem o qual o SmartScreen mostra "editor desconhecido".
3. Hardening: integridade, recuperação de corrupção, testes de falha.
4. Backup ainda mora na tela de Usuários por não haver rota própria (o
   `routeTree.gen.ts` é commitado e não é regenerado no build desktop).

Testes Rust obrigatórios para cada comando novo: permissão, validação, transação e rollback.

## Mapa do sistema legado

`docs/mapa-sistema.md` contém o levantamento completo do sistema em produção
(`k7pavuna.lovable.app`) cruzado com o código legado: telas, regras de negócio,
permissões, layout do ticket e status de cada item na migração. É o checklist de
paridade para a reconstrução desktop.

## Supabase

As telas foram limpas em 04/09: PDV, Estoque, Relatórios e o alerta de validade
não importam mais `supabase`, e os ramos web deles foram removidos, não apenas
desviados. Sobra Supabase só em `src/lib/auth-context.tsx`,
`src/lib/ticket-settings.ts` e `src/lib/users.functions.ts`, que o
`vite.desktop.config.ts` substitui por shims no build desktop.

Não remova a barreira de shims para “fazer funcionar”. Implemente o comando Rust
correspondente.

## Roadmap técnico de implementação

Ordem sugerida:

1. Build desktop reproduzível e inicialização do SQLite.
2. Autenticação local e autorização no Rust. Parcialmente concluído.
3. Cadastro de produtos, estoque e lotes locais.
4. Venda transacional local e numeração.
5. Ticket e impressão desktop.
6. Relatórios consultando apenas SQLite.
7. Gestão completa de usuários locais.
8. Configuração de impressora e ticket no SQLite.
9. Backup manual, automático, retenção e restauração validada.
10. Hardening: CSP, logs sem dados sensíveis, integridade, limites, recuperação de corrupção e testes de falha.
11. Empacotamento Windows/macOS/Linux e assinatura de instaladores/atualizações.

## Segurança e invariantes

- Nunca confiar em preço, subtotal, total, perfil ou permissão enviados pelo React.
- Toda autorização é revalidada no Rust.
- Toda entrada Tauri deve ter limites de tamanho/faixa e mensagens de erro seguras.
- Usar queries parametrizadas; não montar SQL com concatenação.
- Não registrar senhas, hashes, tokens ou dados sensíveis em logs/auditoria.
- O arquivo SQLite ainda não está criptografado. Não afirmar criptografia em repouso.
- Backups devem ser consistentes (SQLite backup API/VACUUM INTO), nunca simples cópia insegura durante escrita.
- Restauração futura precisa validar schema, integridade e versão antes de substituir o banco ativo.
- Atualização assinada ainda não foi implementada.
- Impressão ainda usa `window.print()` no legado e precisa migrar para controle desktop.

## Observações do repositório

- Dependências JS já foram instaladas e `bun.lock`/`package-lock.json` podem estar modificados.
- `src-tauri/Cargo.lock` foi criado.
- O ponteiro `.git` está quebrado e aponta para um worktree em `/nix/store/...`; `git status` atualmente falha. Não tentar corrigir, resetar ou apagar alterações sem autorização do usuário.
- Há um `.env` legado. Não copiar segredos para código, logs ou para este arquivo.
- Preserve o modo web existente enquanto a migração acontece, salvo nova orientação explícita.

## Definição de “100% offline” neste projeto

O aplicativo instalado deve iniciar, autenticar, vender, movimentar estoque, consultar relatórios, imprimir, configurar, fazer backup e restaurar sem rede desde o primeiro uso. Ausência de internet não é estado de erro e não deve mudar o comportamento funcional, exceto pela verificação/download manual de futuras atualizações quando autorizada.

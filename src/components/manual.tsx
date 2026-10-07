import { useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  Database,
  Building2,
  ChevronRight,
  KeyRound,
  Package,
  Printer,
  Ticket as TicketIcon,
  TrendingUp,
  ShoppingCart,
} from "lucide-react";
import { Rotulo } from "@/components/placa";
import { cn } from "@/lib/utils";

/**
 * Manual de operação, dentro do próprio sistema.
 *
 * Quem opera troca de turno e raramente recebe treinamento formal. O manual
 * mora aqui, e não num arquivo separado, porque um PDF que ninguém abre não
 * é documentação — é arquivo.
 */

type Secao = {
  id: string;
  titulo: string;
  icone: React.ReactNode;
  conteudo: React.ReactNode;
};

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
);

const Passo = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-xs font-bold">
      {n}
    </span>
    <span className="text-sm leading-relaxed">{children}</span>
  </li>
);

const Atencao = ({ children }: { children: React.ReactNode }) => (
  <div
    className="flex items-start gap-2.5 border p-3"
    style={{
      borderColor: "var(--warning)",
      background: "color-mix(in oklab, var(--warning) 12%, transparent)",
    }}
  >
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--warning)" }} aria-hidden />
    <span className="text-sm leading-relaxed">{children}</span>
  </div>
);

const SECOES: Secao[] = [
  {
    id: "turno",
    titulo: "Turno: abrir, sangrar e fechar",
    icone: <Banknote className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          O turno é o período entre abrir e fechar a gaveta de dinheiro. Ele existe para responder
          uma pergunta que a venda sozinha não responde: <strong>o dinheiro que deveria estar na
          gaveta está lá?</strong>
        </P>
        <P>
          <strong>O turno é do dia, não da pessoa.</strong> Abre uma vez pela manhã e fecha uma vez
          à noite. Durante o dia pode trocar de operador quantas vezes for preciso — as vendas
          continuam entrando no mesmo turno, e a numeração dos pedidos é do dia, nunca por
          operador. Quem fecha à noite não precisa ser quem abriu de manhã; basta ter permissão
          de fechar.
        </P>

        <div className="placa p-4">
          <Rotulo className="mb-2 block">Como a conta fecha</Rotulo>
          <div className="num space-y-1 text-sm">
            <div className="flex justify-between"><span>Fundo de troco</span><span>+ R$ 200,00</span></div>
            <div className="flex justify-between"><span>Dinheiro recebido nas vendas</span><span>+ R$ 1.340,00</span></div>
            <div className="flex justify-between"><span>Troco devolvido</span><span>− R$ 180,00</span></div>
            <div className="flex justify-between"><span>Suprimento (reforço de troco)</span><span>+ R$ 100,00</span></div>
            <div className="flex justify-between"><span>Sangria (retirada)</span><span>− R$ 500,00</span></div>
            <div className="mt-2 flex justify-between border-t border-border pt-2 font-bold">
              <span>Esperado na gaveta</span><span>R$ 960,00</span>
            </div>
          </div>
        </div>

        <P>
          No fechamento você conta o dinheiro de verdade e digita o valor. O sistema compara com o
          esperado e registra a diferença — para mais ou para menos — com o seu nome.
        </P>

        <Atencao>
          Cartão e PIX <strong>não entram</strong> nessa conta: esse dinheiro não passa pela gaveta.
          Eles aparecem separados no resumo do turno.
        </Atencao>
        <Atencao>
          <strong>Não deixe o turno virar o dia.</strong> Se ninguém fechar à noite, as vendas do
          dia seguinte entram na conferência de ontem e a diferença apurada mistura os dois dias.
          O sistema avisa em amarelo na tela de Venda e na de Turno quando isso acontece — fechar
          é contar dinheiro, e por isso ele nunca fecha sozinho.
        </Atencao>

        <div>
          <Rotulo className="mb-2 block">No dia a dia</Rotulo>
          <ol className="space-y-2">
            <Passo n={1}>
              <strong>Ao começar:</strong> abra o turno informando quanto já está na gaveta para dar
              troco. Dá para abrir direto na tela de Venda.
            </Passo>
            <Passo n={2}>
              <strong>Durante o turno:</strong> se tirar dinheiro para o cofre, registre uma
              <strong> sangria</strong>. Se colocar mais troco, registre um <strong>suprimento</strong>.
              Sem isso a conferência não fecha.
            </Passo>
            <Passo n={3}>
              <strong>Ao terminar o dia:</strong> conte a gaveta e feche o turno. A diferença fica
              registrada e aparece no relatório de Fechamento.
            </Passo>
          </ol>
        </div>
      </div>
    ),
  },
  {
    id: "venda",
    titulo: "Venda: do produto ao cupom",
    icone: <ShoppingCart className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          A tela de Venda tem o catálogo à esquerda e o pedido à direita. Só é possível vender com o
          turno aberto.
        </P>
        <div>
          <Rotulo className="mb-2 block">Atalhos que economizam tempo</Rotulo>
          <ul className="space-y-2 text-sm">
            <li><strong>Leitor de código de barras:</strong> ele digita e dá Enter sozinho — o produto entra no pedido. Só funciona se o EAN estiver cadastrado no Estoque.</li>
            <li><strong>Vários iguais:</strong> digite o número na busca e toque no produto. "6" e um toque na cerveja lança seis.</li>
            <li><strong>Pulseira no pedido:</strong> a tela inteira acende e aparece uma faixa grande com a quantidade — para o cliente conferir do outro lado do balcão e para ficar registrado na câmera.</li>
            <li><strong>F2</strong> abre o recebimento. <strong>Esc</strong> limpa a busca.</li>
            <li><strong>Valores em dinheiro</strong> são digitados por centavos, como na maquininha: <strong>800</strong> é R$ 8,00 e <strong>8</strong> é R$ 0,08.</li>
          </ul>
        </div>
        <div>
          <Rotulo className="mb-2 block">Recebimento</Rotulo>
          <P>
            São dois meios: <strong>Dinheiro</strong> e <strong>Maquininha</strong>, combináveis na
            mesma venda. PIX é cobrado na maquininha, então entra como maquininha. Digite quanto o cliente
            deu em dinheiro e o restante é abatido na maquininha automaticamente. O bloco embaixo
            mostra <strong>Troco</strong> ou <strong>Falta receber</strong>, e não deixa confirmar
            enquanto faltar valor.
          </P>
          <P>
            Quem tem a permissão de desconto vê um campo <strong>Desconto no total</strong>. Ele
            aparece no cupom, com o subtotal acima, e fica registrado no relatório.
          </P>
        </div>
        <div>
          <Rotulo className="mb-2 block">Devolução</Rotulo>
          <P>
            Em <strong>Relatórios → Vendas</strong>, o botão <strong>Devolver</strong> abre a venda
            e permite estornar item por item, escolhendo se o dinheiro volta pela gaveta, pela
            maquininha, por PIX, ou se é troca sem estorno.
          </P>
          <P>
            Devolver <strong>não apaga a venda</strong>: registra o estorno por cima dela. É isso
            que faz o fechamento do turno bater no fim do dia. Você decide se o produto volta ao
            estoque — desmarque quando ele voltou danificado.
          </P>
        </div>
        <Atencao>
          O número grande no cupom é o de retirada. Ele cicla de 0 a 999 e reinicia — dois pedidos
          do mesmo dia nunca repetem o número.
        </Atencao>
      </div>
    ),
  },
  {
    id: "ficha",
    titulo: "Ficha: pagar agora, retirar depois",
    icone: <TicketIcon className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          Serve para quem compra várias bebidas de uma vez e vai buscando uma a uma. O cliente
          paga tudo no caixa; a mercadoria continua na geladeira até ele vir pegar.
        </P>
        <div>
          <Rotulo className="mb-2 block">Como vender em ficha</Rotulo>
          <ol className="space-y-2">
            <Passo n={1}>Monte o pedido normalmente.</Passo>
            <Passo n={2}>
              No item que fica para depois, toque no ícone de <strong>ficha</strong> na linha do
              pedido. Ele ganha a marca "ficha".
            </Passo>
            <Passo n={3}>
              Ao receber, informe o <strong>nome do cliente</strong> — é por ele que a retirada é
              encontrada. Vale apelido: "João da mesa 4".
            </Passo>
          </ol>
        </div>
        <div>
          <Rotulo className="mb-2 block">Como entregar</Rotulo>
          <P>
            Toque no ícone de ficha no alto da tela de Venda. Procure pelo nome ou pelo número do
            pedido e toque em <strong>Entregar 1</strong>. A ficha some da lista quando a última
            unidade sai.
          </P>
        </div>
        <Atencao>
          O <strong>estoque só baixa na entrega</strong>, não na venda. Enquanto a garrafa está na
          geladeira ela existe de verdade — se baixasse na venda, a contagem de inventário acusaria
          sobra e o controle de validade descreveria mercadoria que já saiu. O dinheiro, esse,
          entra na hora da venda.
        </Atencao>
      </div>
    ),
  },
  {
    id: "estoque",
    titulo: "Estoque, lotes e validade",
    icone: <Package className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          Cada entrada de estoque cria um <strong>lote</strong> com sua data de validade. Na venda,
          sai primeiro o lote que vence antes — assim a mercadoria antiga não fica encalhada.
        </P>
        <div>
          <Rotulo className="mb-2 block">Registrar movimento</Rotulo>
          <P>
            Tudo que mexe no saldo passa por um painel só, aberto pelo botão na linha do produto.
            O tipo decide o resto:
          </P>
          <ul className="mt-2 space-y-2 text-sm">
            <li><strong>Entrada (compra):</strong> soma ao saldo, com lote e validade. Se informar o custo, ele recalcula o <strong>custo médio</strong> do produto — a média entre o que já estava parado e o que entrou, não o preço da última compra.</li>
            <li><strong>Saída:</strong> baixa manual por quebra, perda ou uso interno. Consome primeiro o lote que vence antes.</li>
            <li><strong>Inventário:</strong> a quantidade contada passa a valer e a diferença fica registrada com o motivo e o seu nome.</li>
          </ul>
          <P>
            O painel mostra o <strong>saldo depois</strong> antes de confirmar, e a lista de lotes em
            estoque. O motivo que você escrever aparece no relatório de movimentos.
          </P>
        </div>
        <Atencao>
          Toda categoria exige data de validade a cada entrada, <strong>exceto Pulseiras</strong>.
          Ao vender um item de lote vencido, o sistema pede confirmação antes.
        </Atencao>
      </div>
    ),
  },
  {
    id: "variacoes",
    titulo: "Categorias e variações",
    icone: <Boxes className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          <strong>Categoria</strong> organiza o catálogo e define a cor que o produto tem na venda.
          Renomear uma categoria corrige o nome em todos os produtos de uma vez.
        </P>
        <P>
          <strong>Variação</strong> é para o mesmo produto em tamanhos ou quantidades diferentes.
          Cadastre pelo produto pai: abra o produto no Estoque e use <strong>Nova variação</strong>
          dentro do próprio modal.
        </P>
        <P>
          Cada variação tem SKU, código de barras, preço, custo e estoque próprios. O código de
          barras <strong>tem que ser diferente</strong> em cada uma: pela regra da GS1, tamanho ou
          volume diferentes são produtos diferentes, e o leitor precisa distinguir.
        </P>
        <div className="placa p-4 text-sm">
          <div className="font-semibold">Gel Dessensibilizante</div>
          <div className="ml-4 mt-1 flex items-center gap-2 text-muted-foreground">
            <ChevronRight className="h-3 w-3" aria-hidden /> 50 ml — R$ 25,00 — 12 em estoque
          </div>
          <div className="ml-4 flex items-center gap-2 text-muted-foreground">
            <ChevronRight className="h-3 w-3" aria-hidden /> 100 ml — R$ 38,00 — 4 em estoque
          </div>
        </div>
        <Atencao>
          O produto que agrupa variações <strong>não aparece na venda</strong>: quem é vendido é a
          variação. Por isso ele não tem preço nem estoque próprios.
        </Atencao>
      </div>
    ),
  },
  {
    id: "dados",
    titulo: "Backup e modelo de loja",
    icone: <Database className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          Em <strong>Configurações → Dados e backup</strong> ficam as duas cópias que o sistema
          sabe fazer. Elas servem para coisas diferentes:
        </P>
        <div>
          <Rotulo className="mb-2 block">Backup × Modelo de loja</Rotulo>
          <ul className="space-y-2 text-sm">
            <li><strong>Backup:</strong> esta loja inteira — vendas, turnos, estoque, lotes, fornecedores, contas e configurações. Serve para <strong>voltar aqui</strong> depois de um problema.</li>
            <li><strong>Modelo de loja:</strong> só o que as lojas têm em comum — catálogo, categorias, cupom, perfis e contas. Serve para <strong>levar para outra loja</strong>. Vendas, turnos e estoque nunca viajam. É um arquivo <span className="num">.toml</span> de texto, que dá para abrir e conferir antes de importar.</li>
          </ul>
        </div>
        <P>
          O backup roda sozinho uma vez por dia, na abertura, e as 15 cópias mais recentes são
          mantidas. Antes de qualquer restauração, o sistema confere a integridade do arquivo e
          grava o estado atual — dá para desfazer.
        </P>
        <div>
          <Rotulo className="mb-2 block">Onde os arquivos ficam</Rotulo>
          <P>
            A tela mostra o caminho exato desta máquina. No Windows, é dentro do perfil do usuário:
          </P>
          <div className="placa mt-2 p-3">
            <p className="num break-all text-xs">
              C:\Users\&lt;usuário&gt;\AppData\Roaming\br.com.dizevolv.k7cabines\backups
            </p>
          </div>
          <P>
            No macOS, em <span className="num">~/Library/Application Support/br.com.dizevolv.k7cabines/backups</span>.
            A pasta <span className="num">AppData</span> é oculta no Windows: cole o caminho na
            barra do Explorador de Arquivos para chegar nela.
          </P>
        </div>
        <Atencao>
          O backup fica <strong>na mesma máquina</strong>. Se o computador queimar ou for roubado,
          ele vai junto. Use <strong>Salvar cópia em…</strong> para gravar num pendrive de tempos
          em tempos — é a única proteção real contra perder o computador.
        </Atencao>
      </div>
    ),
  },
  {
    id: "resultado",
    titulo: "Resultado e relatórios",
    icone: <TrendingUp className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          A aba <strong>Resultado</strong> em Relatórios mostra a conta do período, de cima para
          baixo, como num extrato:
        </P>
        <div className="placa p-4">
          <div className="num space-y-1 text-sm">
            <div className="flex justify-between"><span>Receita bruta</span><span>R$ 4.200,00</span></div>
            <div className="flex justify-between"><span>Descontos concedidos</span><span>− R$ 120,00</span></div>
            <div className="flex justify-between"><span>Devoluções</span><span>− R$ 80,00</span></div>
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-bold"><span>Receita líquida</span><span>R$ 4.000,00</span></div>
            <div className="flex justify-between"><span>Custo das mercadorias (CMV)</span><span>− R$ 1.600,00</span></div>
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-bold"><span>Lucro bruto</span><span>R$ 2.400,00</span></div>
          </div>
        </div>
        <P>
          O <strong>CMV</strong> usa o custo congelado no momento de cada venda, não o custo de
          hoje: o custo muda a cada compra, e usar o de hoje inventaria a margem de uma venda
          antiga. Por isso importa informar o custo na entrada de estoque.
        </P>
        <Atencao>
          A conta <strong>para no lucro bruto</strong>. O sistema não registra aluguel, salário nem
          outras despesas, então este não é o lucro final da loja. Se aparecer um aviso de itens
          "sem custo registrado", a margem mostrada está alta demais.
        </Atencao>
        <div>
          <Rotulo className="mb-2 block">O que mais tem na tela</Rotulo>
          <ul className="space-y-2 text-sm">
            <li><strong>Como o dinheiro entrou:</strong> a divisão entre dinheiro, maquininha e PIX. O dinheiro já vem sem o troco — só ele passa pela gaveta.</li>
            <li><strong>Por categoria:</strong> receita, custo, lucro, margem e quanto cada uma representa do total. É onde se vê o que dá dinheiro de verdade.</li>
            <li><strong>Dia a dia:</strong> receita e lucro de cada dia do período.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: "impressora",
    titulo: "Impressora e cupom",
    icone: <Printer className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          A impressora é configurada em <strong>Configurações → Impressora</strong>, e a escolha
          vale só nesta máquina — ela não viaja no template entre lojas.
        </P>
        <div>
          <Rotulo className="mb-2 block">Os três modos</Rotulo>
          <ul className="space-y-2 text-sm">
            <li><strong>Impressora térmica (ESC/POS):</strong> o normal. Imprime direto, sem diálogo, corta o papel e pode abrir a gaveta.</li>
            <li><strong>Impressora comum (texto):</strong> manda o texto sem comandos de corte, para impressora de folha.</li>
            <li><strong>Diálogo do sistema:</strong> abre a caixa de impressão a cada cupom. Só como saída de emergência.</li>
          </ul>
        </div>
        <div>
          <Rotulo className="mb-2 block">Como acertar o papel</Rotulo>
          <P>
            Toque em <strong>Imprimir teste</strong>. A página traz uma régua numerada e duas
            linhas de acentuação. Se a régua terminar exatamente na borda do papel, as colunas
            estão certas; se sobrar espaço, aumente; se passar, diminua. Se os acentos saírem
            errados, mude a tabela de acentos.
          </P>
        </div>
        <Atencao>
          A gaveta só abre em venda que recebeu <strong>dinheiro</strong>. Em venda no cartão ou PIX
          ela fica fechada — abrir à toa é deixar o caixa exposto sem motivo.
        </Atencao>
        <P>
          Se a impressora não responder no meio do movimento, o sistema avisa e abre o diálogo do
          sistema automaticamente. Um cupom pelo diálogo é melhor que nenhum com a fila esperando.
        </P>
      </div>
    ),
  },
  {
    id: "fornecedores",
    titulo: "Fornecedores e custo",
    icone: <Building2 className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          Fornecedor é quem abastece a loja. O cadastro fica em <strong>Estoque → Fornecedores</strong>:
          nome, CNPJ ou CPF (opcional, conferido na hora), contato e observação.
        </P>
        <div>
          <Rotulo className="mb-2 block">Onde o fornecedor aparece</Rotulo>
          <ul className="space-y-2 text-sm">
            <li><strong>No produto:</strong> o "fornecedor habitual" é só uma sugestão, que já vem escolhida na hora da entrada.</li>
            <li><strong>Na entrada de estoque:</strong> aqui é que vale. O fornecedor fica gravado <strong>naquela compra</strong>, mesmo que o produto mude de fornecedor depois.</li>
            <li><strong>No histórico:</strong> o botão de relógio na linha do fornecedor mostra tudo que entrou por ele, com data, quantidade e custo.</li>
          </ul>
        </div>
        <Atencao>
          Fornecedor não é excluído, é <strong>desativado</strong> — e só depois que nenhum produto
          aponta para ele. Apagar transformaria a procedência de todo o custo já registrado em nada.
          Reativar é um clique quando voltar a comprar.
        </Atencao>
        <P>
          A coluna <strong>Últ. compra</strong> no estoque mostra quanto se pagou da última vez e de
          quem. Serve para responder por que o custo médio subiu: foi uma compra específica, com um
          fornecedor específico.
        </P>
      </div>
    ),
  },
  {
    id: "acesso",
    titulo: "Contas e permissões",
    icone: <KeyRound className="h-4 w-4" />,
    conteudo: (
      <div className="space-y-4">
        <P>
          Não existe autocadastro. Todas as contas são criadas em Configurações → Usuários por quem
          tem a permissão de gerir usuários — normalmente a conta <strong>master</strong>.
        </P>
        <P>
          Cada conta recebe um <strong>perfil</strong>, que define o padrão de permissões. O sistema
          vem com Gerente, Supervisor e Atendente, e você pode criar outros em
          Configurações → Usuários → <strong>Novo perfil</strong>.
        </P>
        <div>
          <Rotulo className="mb-2 block">Perfil e exceção</Rotulo>
          <ul className="space-y-2 text-sm">
            <li><strong>Perfil:</strong> o padrão herdado por todas as contas que o usam. Mudar o perfil muda para todo mundo de uma vez.</li>
            <li><strong>Exceção:</strong> marcar algo fora do perfil, só para uma pessoa. Serve para o caso isolado — o atendente de confiança que também repõe a geladeira — sem precisar criar um perfil novo.</li>
          </ul>
        </div>
        <Atencao>
          <strong>Exceção não é afetada pelo perfil.</strong> Se você tirar "ver relatórios" do
          perfil Atendente e alguém continuar vendo, é porque essa pessoa tem a permissão como
          exceção. A lista de contas mostra <strong>"+N fora do perfil"</strong> em amarelo, e
          dentro da conta existe o botão <strong>Usar só o perfil</strong>, que zera as exceções.
        </Atencao>
        <div>
          <ul className="space-y-2 text-sm">
          </ul>
        </div>
        <Atencao>
          Perfil de fábrica tem o nome fixo, porque ele já está gravado no histórico de quem o teve;
          as permissões dele você ajusta à vontade. Perfil criado por você só pode ser excluído
          quando nenhuma conta o estiver usando.
        </Atencao>
        <div>
          <Rotulo className="mb-2 block">Senha provisória</Rotulo>
          <P>
            Conta criada pelo gestor nasce com <strong>senha provisória</strong>. No primeiro
            acesso, o sistema para numa tela pedindo que a pessoa defina a sua — e{" "}
            <strong>nada funciona antes disso</strong>: nem vender, nem abrir turno. O mesmo vale
            quando o gestor redefine a senha de alguém.
          </P>
          <P>
            O motivo é simples: a senha entregue no papel passou por outra pessoa. Enquanto ela
            valer, o sistema não consegue provar quem vendeu, quem deu desconto ou quem fechou o
            caixa — e é justamente isso que o registro serve para responder.
          </P>
        </div>
        <Atencao>
          A conta master do sistema não pode ser excluída nem rebaixada, para que a loja nunca fique
          sem quem administre. A senha dela pode ser trocada. <strong>Sem internet não existe
          recuperação de senha</strong> — anote em local seguro.
        </Atencao>
      </div>
    ),
  },
];

export function Manual() {
  const [aberta, setAberta] = useState<string>(SECOES[0].id);

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <nav className="painel h-fit overflow-hidden" aria-label="Seções do manual">
        {SECOES.map((s) => (
          <button
            key={s.id}
            onClick={() => setAberta(s.id)}
            aria-current={aberta === s.id ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left text-sm transition-colors last:border-b-0",
              aberta === s.id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {s.icone}
            <span className="min-w-0 flex-1">{s.titulo}</span>
          </button>
        ))}
      </nav>

      <section className="placa max-w-3xl p-5">
        {SECOES.filter((s) => s.id === aberta).map((s) => (
          <div key={s.id}>
            <h2 className="mb-4 flex items-center gap-2 text-xl">
              {s.icone}
              {s.titulo}
            </h2>
            {s.conteudo}
          </div>
        ))}
      </section>
    </div>
  );
}

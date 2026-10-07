import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  KeyRound,
  Database,
  Printer,

  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import { desktop, isDesktop, type SetupStatus, type SystemParam } from "@/lib/desktop";
import { Rotulo } from "@/components/placa";
import { Ticket, type TicketSale } from "@/components/ticket";
import { ConfigImpressora } from "@/components/config-impressora";
import { ConfigDados } from "@/components/config-dados";
import { aplicarFonte } from "@/lib/fonte";
import { Ajuda } from "@/components/ajuda";
import { checarDocumento, formatarDocumento, formatarTelefone } from "@/lib/documento";
import {
  DEFAULT_TICKET_SETTINGS,
  fetchTicketSettings,
  saveTicketSettings,
  type TicketSettings,
} from "@/lib/ticket-settings";
import { cn } from "@/lib/utils";
import { GestaoUsuarios } from "@/components/gestao-usuarios";
import { Manual } from "@/components/manual";

export const Route = createFileRoute("/_app/configuracoes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Configurações" }] }),
  component: ConfiguracoesPage,
});

/** Venda fictícia para a pré-visualização do cupom. */
const CUPOM_EXEMPLO: TicketSale = {
  sale_number: 42,
  total: 75.5,
  cash_amount: 100,
  card_amount: 0,
  change_amount: 24.5,
  operator_name: "Operador",
  created_at: new Date().toISOString(),
  items: [
    { product_code: "123", product_name: "Pulseira K7", unit_price: 30, quantity: 1, subtotal: 30 },
    { product_code: "21231", product_name: "Heineken", unit_price: 12, quantity: 2, subtotal: 24 },
    { product_code: "2132", product_name: "Água SEM Gás", unit_price: 3, quantity: 1, subtotal: 3 },
    { product_code: "22220", product_name: "Volumão", unit_price: 18.5, quantity: 1, subtotal: 18.5 },
  ],
};

type Aba =
  | "loja"
  | "impressao"
  | "usuarios"
  | "dados"
  | "parametros"
  | "conta"
  | "manual";

const ABAS: { id: Aba; rotulo: string; icone: React.ReactNode }[] = [
  { id: "loja", rotulo: "Loja", icone: <Building2 className="h-4 w-4" /> },
  { id: "impressao", rotulo: "Impressão", icone: <Printer className="h-4 w-4" /> },
  { id: "usuarios", rotulo: "Usuários", icone: <Users className="h-4 w-4" /> },
  { id: "dados", rotulo: "Dados e backup", icone: <Database className="h-4 w-4" /> },
  { id: "parametros", rotulo: "Parâmetros", icone: <SlidersHorizontal className="h-4 w-4" /> },
  { id: "conta", rotulo: "Minha conta", icone: <KeyRound className="h-4 w-4" /> },
  { id: "manual", rotulo: "Manual", icone: <BookOpen className="h-4 w-4" /> },
];

function ConfiguracoesPage() {
  const { session, profile, pode } = useAuth();
  const token = session && "token" in session ? session.token : null;
  const podeConfigurar = profile?.access_usuarios ?? false;

  const [aba, setAba] = useState<Aba>("loja");
  const [instalacao, setInstalacao] = useState<SetupStatus | null>(null);
  const [ticket, setTicket] = useState<TicketSettings>(DEFAULT_TICKET_SETTINGS);
  /* Documento conferido enquanto se digita; o Rust revalida ao salvar. */
  const checagemDoc = useMemo(() => checarDocumento(ticket.document ?? ""), [ticket.document]);
  const [parametros, setParametros] = useState<SystemParam[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaConfirma, setSenhaConfirma] = useState("");
  const [trocando, setTrocando] = useState(false);

  const carregar = useCallback(async () => {
    if (!isDesktop() || !token) return;
    try {
      setInstalacao(await desktop.setupStatus());
    } catch { /* instalação anterior ao assistente */ }
    fetchTicketSettings().then(setTicket).catch(() => {});
    desktop.listParams(token).then(setParametros).catch(() => {});
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const gruposParam = useMemo(() => {
    const mapa = new Map<string, SystemParam[]>();
    for (const p of parametros) {
      const lista = mapa.get(p.grupo) ?? [];
      lista.push(p);
      mapa.set(p.grupo, lista);
    }
    return [...mapa.entries()];
  }, [parametros]);

  if (!podeConfigurar) return <Navigate to="/pdv" />;

  const upd = <K extends keyof TicketSettings>(k: K, v: TicketSettings[K]) =>
    setTicket((p) => ({ ...p, [k]: v }));

  const salvarTicket = async () => {
    setSalvando(true);
    try {
      await saveTicketSettings(ticket);
      toast.success("Configurações salvas");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  };

  const salvarParametro = async (p: SystemParam, valor: string) => {
    if (!token) return;
    setParametros((atual) => atual.map((x) => (x.key === p.key ? { ...x, value: valor } : x)));
    // A letra muda enquanto se digita: é um ajuste que só se acerta vendo.
    if (p.key === "interface.fonte") {
      aplicarFonte(parseInt(valor, 10) || 100);
    }
    try {
      await desktop.setParam(token, p.key, valor);
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Valor recusado");
      // Recarrega para não deixar na tela um valor que o banco não aceitou.
      desktop
        .listParams(token)
        .then((lista) => {
          setParametros(lista);
          const fonte = lista.find((x) => x.key === "interface.fonte");
          if (fonte) aplicarFonte(parseInt(fonte.value, 10) || 100);
        })
        .catch(() => {});
    }
  };

  const trocarSenha = async () => {
    if (!token) return;
    if (senhaNova.length < 8) return toast.error("A nova senha precisa de ao menos 8 caracteres");
    if (senhaNova !== senhaConfirma) return toast.error("As senhas não conferem");
    setTrocando(true);
    try {
      await desktop.changeOwnPassword(token, {
        current_password: senhaAtual,
        new_password: senhaNova,
      });
      toast.success("Senha alterada");
      setSenhaAtual("");
      setSenhaNova("");
      setSenhaConfirma("");
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível trocar a senha");
    } finally {
      setTrocando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
        <h1 className="text-3xl">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Tudo que parametriza o sistema desta loja, num lugar só.
        </p>
      </header>

      <nav className="trilho flex shrink-0 gap-1 overflow-x-auto px-4 py-2 sm:px-6" aria-label="Seções">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            aria-current={aba === a.id ? "page" : undefined}
            className={cn(
              "rotulo flex h-11 shrink-0 items-center gap-2 border px-3 text-[12px] transition-colors",
              aba === a.id
                ? "border-transparent bg-secondary text-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {a.icone}
            {a.rotulo}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6">
        {aba === "loja" && (
          /*
           * Tudo aqui sai impresso no cabeçalho do cupom — é essa a razão de
           * cada campo existir. Nada disto viaja no modelo de loja: endereço e
           * CNPJ são justamente o que muda de uma loja para a outra.
           */
          <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
            <section className="placa p-5">
              <h2 className="text-lg">Identificação</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                O nome fantasia é o que aparece maior no topo do cupom.
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loja">Nome fantasia</Label>
                  <Input
                    id="loja"
                    value={ticket.store_name}
                    onChange={(e) => upd("store_name", e.target.value)}
                    placeholder="Ex.: K7 Cabines Pavuna"
                    className="campo h-12 rounded-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="razao">Razão social</Label>
                  <Input
                    id="razao"
                    value={ticket.legal_name}
                    onChange={(e) => upd("legal_name", e.target.value)}
                    placeholder="Opcional, quando diferente do nome fantasia"
                    className="campo h-11 rounded-sm"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="docLoja">CNPJ ou CPF</Label>
                    <Input
                      id="docLoja"
                      inputMode="numeric"
                      value={ticket.document}
                      onChange={(e) => upd("document", e.target.value)}
                      onBlur={() =>
                        upd("document", formatarDocumento(ticket.document) || ticket.document)
                      }
                      placeholder="Opcional"
                      aria-invalid={checagemDoc.estado === "erro"}
                      className={cn(
                        "campo num h-11 rounded-sm",
                        checagemDoc.estado === "erro" && "border-destructive",
                      )}
                    />
                    {checagemDoc.estado === "erro" ? (
                      <p className="text-xs text-destructive">{checagemDoc.mensagem}</p>
                    ) : (
                      checagemDoc.estado === "ok" && (
                        <p className="text-xs" style={{ color: "var(--success)" }}>
                          {checagemDoc.tipo} válido.
                        </p>
                      )
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="telLoja">Telefone</Label>
                    <Input
                      id="telLoja"
                      inputMode="tel"
                      value={formatarTelefone(ticket.phone)}
                      onChange={(e) => upd("phone", e.target.value)}
                      placeholder="(21) 98888-7777"
                      className="campo num h-11 rounded-sm"
                    />
                  </div>
                </div>
              </div>
              <BotaoSalvar onClick={salvarTicket} salvando={salvando} />
            </section>

            <div className="space-y-4">
              <section className="placa p-5">
                <h2 className="text-lg">Endereço</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  Sai abaixo do nome, no cupom. Deixe em branco o que não quiser imprimir.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="endLoja">Rua e número</Label>
                    <Input
                      id="endLoja"
                      value={ticket.address_line}
                      onChange={(e) => upd("address_line", e.target.value)}
                      placeholder="Av. Brasil, 1200 — loja 4"
                      className="campo h-11 rounded-sm"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="bairroLoja">Bairro</Label>
                      <Input
                        id="bairroLoja"
                        value={ticket.district}
                        onChange={(e) => upd("district", e.target.value)}
                        className="campo h-11 rounded-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cepLoja">CEP</Label>
                      <Input
                        id="cepLoja"
                        inputMode="numeric"
                        value={ticket.zip}
                        onChange={(e) => upd("zip", e.target.value)}
                        placeholder="21000-000"
                        className="campo num h-11 rounded-sm"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="cidadeLoja">Cidade</Label>
                        <Ajuda>
                          A cidade também vai no código PIX: o padrão do Banco Central exige o
                          município do recebedor no BR Code.
                        </Ajuda>
                      </div>
                      <Input
                        id="cidadeLoja"
                        value={ticket.city}
                        onChange={(e) => upd("city", e.target.value)}
                        className="campo h-11 rounded-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ufLoja">UF</Label>
                      <Input
                        id="ufLoja"
                        maxLength={2}
                        value={ticket.state}
                        onChange={(e) => upd("state", e.target.value.toUpperCase())}
                        className="campo num h-11 rounded-sm uppercase"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contatoLoja">Linha de contato no rodapé</Label>
                    <Input
                      id="contatoLoja"
                      value={ticket.contact_line}
                      onChange={(e) => upd("contact_line", e.target.value)}
                      placeholder="@k7cabines · WhatsApp (21) 98888-7777"
                      className="campo h-11 rounded-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Última linha do cupom, depois da mensagem de rodapé.
                    </p>
                  </div>
                </div>
                <BotaoSalvar onClick={salvarTicket} salvando={salvando} />
              </section>

              {instalacao && (
                <section className="placa p-5">
                  <h2 className="text-lg">Esta instalação</h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Cada loja roda sozinha. Nada aqui se comunica com outra loja.
                  </p>
                  <Rotulo>Identificador</Rotulo>
                  <p className="num mt-1 break-all text-xs text-muted-foreground">
                    {instalacao.installation_id}
                  </p>
                </section>
              )}
            </div>
          </div>
        )}

        {aba === "impressao" && (
          <div className="space-y-6">
            <ConfigImpressora podeConfigurar={pode("printer.configure")} />

            <div className="border-t border-border pt-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <section className="placa p-5">
              <h2 className="text-lg">Conteúdo do cupom</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Cupom não fiscal. As alterações valem para todas as impressões após salvar.
              </p>

              <div className="space-y-3">
                <Campo
                  id="fiscal"
                  rotulo="Etiqueta fiscal"
                  valor={ticket.fiscal_label}
                  onChange={(v) => upd("fiscal_label", v)}
                  ajuda="Faixa preta no topo. Em branco, some."
                />
                <Campo
                  id="rodape"
                  rotulo="Mensagem de rodapé"
                  valor={ticket.footer_message}
                  onChange={(v) => upd("footer_message", v)}
                />
                <Campo
                  id="chap"
                  rotulo="Rótulo do número do pedido"
                  valor={ticket.chapelaria_label}
                  onChange={(v) => upd("chapelaria_label", v)}
                  ajuda="Fica acima do número grande, que é como o cliente retira."
                />
                <Campo
                  id="oper"
                  rotulo="Rótulo do operador"
                  valor={ticket.operator_label}
                  onChange={(v) => upd("operator_label", v)}
                />

                <div className="space-y-2 border-t border-border pt-3">
                  <Interruptor
                    rotulo="Mostrar número do pedido"
                    ligado={ticket.show_chapelaria}
                    onChange={(v) => upd("show_chapelaria", v)}
                  />
                  <Interruptor
                    rotulo="Mostrar data e hora"
                    ligado={ticket.show_datetime}
                    onChange={(v) => upd("show_datetime", v)}
                  />
                  <Interruptor
                    rotulo="Mostrar operador"
                    ligado={ticket.show_operator}
                    onChange={(v) => upd("show_operator", v)}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="campo h-12 rounded-sm"
                  onClick={() => setTicket({ ...DEFAULT_TICKET_SETTINGS, store_name: ticket.store_name })}
                >
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Restaurar padrão
                </Button>
                <BotaoSalvar onClick={salvarTicket} salvando={salvando} inline />
              </div>
            </section>

            <section>
              <Rotulo className="mb-2 block">Pré-visualização</Rotulo>
              <div className="mx-auto w-[320px] bg-white p-3 text-black">
                <Ticket sale={CUPOM_EXEMPLO} settings={ticket} />
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Venda fictícia, largura de 80 mm
              </p>
            </section>
          </div>
            </div>
          </div>
        )}

        {aba === "usuarios" && <GestaoUsuarios />}

        {aba === "dados" && <ConfigDados podeGerir={pode("backup.manage")} />}

        {aba === "parametros" && (
          <div className="max-w-3xl space-y-4">
            <p className="text-sm text-muted-foreground">
              Regras que mudam o comportamento do sistema. Cada uma vale só nesta instalação e
              passa a valer na hora.
            </p>
            {gruposParam.length === 0 ? (
              <p className="placa p-10 text-center text-sm text-muted-foreground">
                Nenhum parâmetro disponível.
              </p>
            ) : (
              gruposParam.map(([grupo, itens]) => (
                <section key={grupo} className="placa p-5">
                  <Rotulo className="mb-1 block">{grupo}</Rotulo>
                  <div>
                    {itens.map((p) => (
                      <ParametroLinha key={p.key} param={p} onSalvar={salvarParametro} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}

        {aba === "manual" && <Manual />}

        {aba === "conta" && (
          <section className="placa max-w-xl p-5">
            <h2 className="text-lg">Minha senha</h2>
            <p className="mb-4 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Sem internet não existe recuperação de senha. Se esta é a conta master, anote a nova
              senha em local seguro antes de trocar.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="atual">Senha atual</Label>
                <Input
                  id="atual"
                  type="password"
                  autoComplete="current-password"
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                  className="campo h-12 rounded-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nova">Nova senha</Label>
                  <Input
                    id="nova"
                    type="password"
                    autoComplete="new-password"
                    value={senhaNova}
                    onChange={(e) => setSenhaNova(e.target.value)}
                    className="campo h-12 rounded-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirma">Repetir nova senha</Label>
                  <Input
                    id="confirma"
                    type="password"
                    autoComplete="new-password"
                    value={senhaConfirma}
                    onChange={(e) => setSenhaConfirma(e.target.value)}
                    className="campo h-12 rounded-sm"
                  />
                </div>
              </div>
            </div>

            <Button
              onClick={trocarSenha}
              disabled={trocando || !senhaAtual || !senhaNova}
              className="mt-4 h-12 rounded-sm font-bold uppercase"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {trocando ? "Trocando…" : "Trocar senha"}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}

function Campo({
  id,
  rotulo,
  valor,
  onChange,
  ajuda,
  max,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  ajuda?: string;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        maxLength={max}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="campo h-12 rounded-sm"
      />
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

function Interruptor({
  rotulo,
  ligado,
  onChange,
}: {
  rotulo: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border border-border px-3 py-2.5">
      <span className="text-sm">{rotulo}</span>
      <input
        type="checkbox"
        checked={ligado}
        onChange={(e) => onChange(e.target.checked)}
        className="marcador"
      />
    </label>
  );
}

/**
 * Uma linha de parâmetro. O valor fica num campo com moldura visível, porque
 * número solto na tela não parece editável; a faixa aceita aparece só quando
 * o campo está em foco, para não poluir a leitura.
 */
function ParametroLinha({
  param,
  onSalvar,
}: {
  param: SystemParam;
  onSalvar: (p: SystemParam, valor: string) => void;
}) {
  const [rascunho, setRascunho] = useState(param.value);
  const [focado, setFocado] = useState(false);

  useEffect(() => {
    setRascunho(param.value);
  }, [param.value]);

  if (param.tipo === "booleano") {
    const ligado = param.value === "1";
    return (
      <label className="flex cursor-pointer items-start gap-3 border-b border-border/60 py-3 last:border-b-0">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(e) => onSalvar(param, e.target.checked ? "1" : "0")}
          className="marcador mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{param.rotulo}</span>
          {param.descricao && (
            <span className="block text-xs text-muted-foreground">{param.descricao}</span>
          )}
        </span>
      </label>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={param.key} className="block text-sm font-medium">
          {param.rotulo}
        </label>
        {param.descricao && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{param.descricao}</p>
        )}
        {focado && param.minimo !== null && param.maximo !== null && (
          <p className="rotulo num mt-1 text-[10px]" style={{ color: "var(--ring)" }}>
            aceita de {param.minimo} a {param.maximo}
          </p>
        )}
      </div>
      <input
        id={param.key}
        value={rascunho}
        inputMode={param.tipo === "inteiro" ? "numeric" : "text"}
        onChange={(e) => setRascunho(e.target.value)}
        onFocus={() => setFocado(true)}
        onBlur={() => {
          setFocado(false);
          if (rascunho !== param.value) onSalvar(param, rascunho);
        }}
        className="campo num h-11 w-24 shrink-0 rounded-sm px-3 text-right text-lg font-semibold"
      />
    </div>
  );
}

function BotaoSalvar({
  onClick,
  salvando,
  inline,
}: {
  onClick: () => void;
  salvando: boolean;
  inline?: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={salvando}
      variant="ghost"
      className={cn("acao-receber h-12 rounded-sm px-6 font-bold uppercase", !inline && "mt-5")}
      style={{ fontFamily: "var(--font-display)" }}
    >
      <Save className="mr-2 h-4 w-4" aria-hidden />
      {salvando ? "Salvando…" : "Salvar"}
    </Button>
  );
}

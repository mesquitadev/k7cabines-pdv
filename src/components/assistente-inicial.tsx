import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileUp,
  Package,
  Printer,
  Receipt,
  SlidersHorizontal,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Rotulo } from "@/components/placa";
import { ConfigImpressora } from "@/components/config-impressora";
import { desktop, desktopToken, type SystemParam } from "@/lib/desktop";
import {
  DEFAULT_TICKET_SETTINGS,
  fetchTicketSettings,
  saveTicketSettings,
  type TicketSettings,
} from "@/lib/ticket-settings";
import { checarDocumento, formatarDocumento, formatarTelefone } from "@/lib/documento";
import { aplicarFonte } from "@/lib/fonte";
import { cn } from "@/lib/utils";

/**
 * Assistente de configuração inicial.
 *
 * Aparece uma vez, para o master, logo depois de a loja ser nomeada. Leva
 * pelo que precisa estar certo antes da primeira venda: o que sai no cupom,
 * em que impressora, com que letra, e de onde vem o catálogo.
 *
 * Tudo aqui já existe em Configurações. O assistente só ordena — e por isso
 * nada é obrigatório: "Deixar para depois" fecha e o roteiro volta na próxima
 * entrada do master, até ser concluído ou dispensado de vez.
 */

type Passo = "loja" | "cupom" | "impressora" | "parametros" | "catalogo" | "pronto";

const PASSOS: { id: Passo; titulo: string; icone: React.ReactNode }[] = [
  { id: "loja", titulo: "Loja", icone: <Building2 className="h-4 w-4" /> },
  { id: "cupom", titulo: "Cupom", icone: <Receipt className="h-4 w-4" /> },
  { id: "impressora", titulo: "Impressora", icone: <Printer className="h-4 w-4" /> },
  { id: "parametros", titulo: "Parâmetros", icone: <SlidersHorizontal className="h-4 w-4" /> },
  { id: "catalogo", titulo: "Catálogo", icone: <Package className="h-4 w-4" /> },
  { id: "pronto", titulo: "Pronto", icone: <Check className="h-4 w-4" /> },
];

/** Marca que o master pediu para ver depois, só nesta sessão do aplicativo. */
const CHAVE_ADIADO = "k7:assistente-adiado";

export function assistenteAdiado(): boolean {
  try {
    return sessionStorage.getItem(CHAVE_ADIADO) === "1";
  } catch {
    return false;
  }
}

export function AssistenteInicial({
  nomeLoja,
  onFechar,
}: {
  nomeLoja: string;
  /** Chamado ao concluir ou ao adiar; o pai decide o que mostrar depois. */
  onFechar: () => void;
}) {
  const token = desktopToken();
  const [passo, setPasso] = useState<Passo>("loja");
  const [ticket, setTicket] = useState<TicketSettings>(DEFAULT_TICKET_SETTINGS);
  const [parametros, setParametros] = useState<SystemParam[]>([]);
  const [busy, setBusy] = useState(false);
  const [produtos, setProdutos] = useState<number | null>(null);
  const [importado, setImportado] = useState<string | null>(null);

  const checagemDoc = useMemo(() => checarDocumento(ticket.document ?? ""), [ticket.document]);

  const carregar = useCallback(async () => {
    if (!token) return;
    fetchTicketSettings().then(setTicket).catch(() => {});
    desktop.listParams(token).then(setParametros).catch(() => {});
    desktop
      .listProducts(token)
      .then((lista) => setProdutos(lista.length))
      .catch(() => setProdutos(null));
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const upd = <K extends keyof TicketSettings>(k: K, v: TicketSettings[K]) =>
    setTicket((p) => ({ ...p, [k]: v }));

  const indice = PASSOS.findIndex((p) => p.id === passo);
  const ir = (delta: number) => {
    const alvo = PASSOS[Math.min(PASSOS.length - 1, Math.max(0, indice + delta))];
    setPasso(alvo.id);
  };

  /** Loja e cupom gravam ao avançar: o que a pessoa viu é o que fica. */
  const salvarTicketEAvancar = async () => {
    if (ticket.store_name.trim().length < 2) return toast.error("Informe o nome da loja");
    if (checagemDoc.estado === "erro") return toast.error(checagemDoc.mensagem);
    setBusy(true);
    try {
      await saveTicketSettings(ticket);
      ir(1);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  };

  const salvarParametro = async (p: SystemParam, valor: string) => {
    if (!token) return;
    setParametros((atual) => atual.map((x) => (x.key === p.key ? { ...x, value: valor } : x)));
    if (p.key === "interface.fonte") aplicarFonte(parseInt(valor, 10) || 100);
    try {
      await desktop.setParam(token, p.key, valor);
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Valor recusado");
      desktop.listParams(token).then(setParametros).catch(() => {});
    }
  };

  const importarModelo = async () => {
    if (!token) return;
    const origem = await open({
      title: "Escolher modelo de loja",
      multiple: false,
      directory: false,
      filters: [{ name: "Modelo de loja", extensions: ["toml", "json"] }],
    });
    if (typeof origem !== "string") return;
    setBusy(true);
    try {
      const r = await desktop.importTemplate(token, origem);
      setImportado(
        `${r.produtos_criados} produto(s) criado(s), ${r.produtos_atualizados} atualizado(s)` +
          (r.origem_loja ? ` · vindo de ${r.origem_loja}` : ""),
      );
      toast.success("Modelo importado");
      await carregar();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível importar o modelo");
    } finally {
      setBusy(false);
    }
  };

  const concluir = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await desktop.setOnboarding(token, true);
      toast.success("Configuração inicial concluída");
      onFechar();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível concluir");
    } finally {
      setBusy(false);
    }
  };

  const adiar = () => {
    try {
      sessionStorage.setItem(CHAVE_ADIADO, "1");
    } catch {
      /* sessão privada: vale só até fechar */
    }
    onFechar();
  };

  const gruposParam = useMemo(() => {
    const mapa = new Map<string, SystemParam[]>();
    for (const p of parametros) {
      const lista = mapa.get(p.grupo) ?? [];
      lista.push(p);
      mapa.set(p.grupo, lista);
    }
    return [...mapa.entries()];
  }, [parametros]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="trilho flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <Rotulo className="block">Configuração inicial</Rotulo>
          <h1 className="text-2xl font-black uppercase leading-tight">{nomeLoja || "Nova loja"}</h1>
        </div>
        <nav aria-label="Etapas" className="flex flex-wrap gap-1">
          {PASSOS.map((p, i) => {
            const feito = i < indice;
            const atual = p.id === passo;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPasso(p.id)}
                aria-current={atual ? "step" : undefined}
                className={cn(
                  "rotulo flex h-10 items-center gap-2 border px-3 text-[11px] transition-colors",
                  atual
                    ? "border-primary bg-primary text-primary-foreground"
                    : feito
                      ? "border-border bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                <span className="num">{i + 1}</span>
                {p.icone}
                {p.titulo}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {passo === "loja" && (
            <>
              <Cabecalho
                titulo="Como a loja aparece no cupom"
                texto="O nome fantasia sai maior no topo. Endereço, CNPJ e telefone saem abaixo. Deixe em branco o que não quiser imprimir."
              />
              <section className="placa grid gap-4 p-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <Campo id="loja" rotulo="Nome fantasia">
                    <Input
                      id="loja"
                      value={ticket.store_name}
                      onChange={(e) => upd("store_name", e.target.value)}
                      placeholder="Ex.: K7 Cabines Pavuna"
                      className="campo h-12 rounded-sm"
                      autoFocus
                    />
                  </Campo>
                  <Campo id="razao" rotulo="Razão social">
                    <Input
                      id="razao"
                      value={ticket.legal_name}
                      onChange={(e) => upd("legal_name", e.target.value)}
                      placeholder="Opcional, quando diferente do nome fantasia"
                      className="campo h-11 rounded-sm"
                    />
                  </Campo>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo id="docLoja" rotulo="CNPJ ou CPF">
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
                      {checagemDoc.estado === "erro" && (
                        <p className="text-xs text-destructive">{checagemDoc.mensagem}</p>
                      )}
                    </Campo>
                    <Campo id="telLoja" rotulo="Telefone">
                      <Input
                        id="telLoja"
                        inputMode="tel"
                        value={formatarTelefone(ticket.phone)}
                        onChange={(e) => upd("phone", e.target.value)}
                        placeholder="(21) 98888-7777"
                        className="campo num h-11 rounded-sm"
                      />
                    </Campo>
                  </div>
                </div>
                <div className="space-y-3">
                  <Campo id="endLoja" rotulo="Rua e número">
                    <Input
                      id="endLoja"
                      value={ticket.address_line}
                      onChange={(e) => upd("address_line", e.target.value)}
                      className="campo h-11 rounded-sm"
                    />
                  </Campo>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                    <Campo id="bairro" rotulo="Bairro">
                      <Input
                        id="bairro"
                        value={ticket.district}
                        onChange={(e) => upd("district", e.target.value)}
                        className="campo h-11 rounded-sm"
                      />
                    </Campo>
                    <Campo id="cep" rotulo="CEP">
                      <Input
                        id="cep"
                        inputMode="numeric"
                        value={ticket.zip}
                        onChange={(e) => upd("zip", e.target.value)}
                        className="campo num h-11 rounded-sm"
                      />
                    </Campo>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                    <Campo id="cidade" rotulo="Cidade">
                      <Input
                        id="cidade"
                        value={ticket.city}
                        onChange={(e) => upd("city", e.target.value)}
                        className="campo h-11 rounded-sm"
                      />
                    </Campo>
                    <Campo id="uf" rotulo="UF">
                      <Input
                        id="uf"
                        maxLength={2}
                        value={ticket.state}
                        onChange={(e) => upd("state", e.target.value.toUpperCase())}
                        className="campo h-11 rounded-sm uppercase"
                      />
                    </Campo>
                  </div>
                  <Campo id="contato" rotulo="Linha de contato no rodapé">
                    <Input
                      id="contato"
                      value={ticket.contact_line}
                      onChange={(e) => upd("contact_line", e.target.value)}
                      placeholder="Instagram, site ou telefone de delivery"
                      className="campo h-11 rounded-sm"
                    />
                  </Campo>
                </div>
              </section>
            </>
          )}

          {passo === "cupom" && (
            <>
              <Cabecalho
                titulo="Textos do cupom"
                texto="O que está escrito no papel além dos itens. O número da chapelaria é o que o cliente mostra para retirar o pedido."
              />
              <section className="placa grid gap-4 p-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <Campo id="fiscal" rotulo="Título do cupom">
                    <Input
                      id="fiscal"
                      value={ticket.fiscal_label}
                      onChange={(e) => upd("fiscal_label", e.target.value)}
                      className="campo h-11 rounded-sm"
                    />
                  </Campo>
                  <Campo id="rodape" rotulo="Mensagem de rodapé">
                    <Input
                      id="rodape"
                      value={ticket.footer_message}
                      onChange={(e) => upd("footer_message", e.target.value)}
                      className="campo h-11 rounded-sm"
                    />
                  </Campo>
                </div>
                <div className="space-y-3">
                  <Marcador
                    id="chap"
                    rotulo="Imprimir número da chapelaria"
                    ligado={ticket.show_chapelaria}
                    onChange={(v) => upd("show_chapelaria", v)}
                  />
                  <Campo id="chapRotulo" rotulo="Rótulo da chapelaria">
                    <Input
                      id="chapRotulo"
                      value={ticket.chapelaria_label}
                      onChange={(e) => upd("chapelaria_label", e.target.value)}
                      disabled={!ticket.show_chapelaria}
                      className="campo h-11 rounded-sm"
                    />
                  </Campo>
                  <Marcador
                    id="data"
                    rotulo="Imprimir data e hora"
                    ligado={ticket.show_datetime}
                    onChange={(v) => upd("show_datetime", v)}
                  />
                  <Marcador
                    id="oper"
                    rotulo="Imprimir quem atendeu"
                    ligado={ticket.show_operator}
                    onChange={(v) => upd("show_operator", v)}
                  />
                </div>
              </section>
            </>
          )}

          {passo === "impressora" && (
            <>
              <Cabecalho
                titulo="Impressora térmica"
                texto="Escolha a impressora, a largura do papel e imprima a página de teste. Se ainda não houver impressora ligada, siga em frente e volte em Configurações › Impressão."
              />
              <ConfigImpressora podeConfigurar />
            </>
          )}

          {passo === "parametros" && (
            <>
              <Cabecalho
                titulo="Ajustes da máquina"
                texto="Tamanho da letra, quantas cópias de backup ficam guardadas e outras regras. Cada valor vale só neste computador e muda na hora."
              />
              {gruposParam.map(([grupo, itens]) => (
                <section key={grupo} className="placa p-5">
                  <Rotulo className="mb-1 block">{grupo}</Rotulo>
                  <div>
                    {itens.map((p) => (
                      <ParametroLinha key={p.key} param={p} onSalvar={salvarParametro} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {passo === "catalogo" && (
            <>
              <Cabecalho
                titulo="De onde vem o catálogo"
                texto="Se outra loja já exportou um modelo (.toml), importe aqui: produtos, categorias, cupom e perfis entram de uma vez. Senão, cadastre em Estoque depois."
              />
              <section className="placa p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm">
                      {produtos === null
                        ? "Catálogo ainda não carregado."
                        : produtos === 0
                          ? "Nenhum produto cadastrado ainda."
                          : `${produtos} produto(s) no catálogo.`}
                    </p>
                    {importado && (
                      <p className="mt-1 text-xs" style={{ color: "var(--success)" }}>
                        {importado}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="campo h-11 rounded-sm px-4"
                    disabled={busy}
                    onClick={importarModelo}
                  >
                    <FileUp className="mr-2 h-4 w-4" aria-hidden /> Importar modelo de loja…
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Produto com o mesmo código é atualizado; o que falta é criado com estoque zero. O
                  saldo de cada item entra depois, em Estoque, com lote e validade.
                </p>
              </section>
            </>
          )}

          {passo === "pronto" && (
            <>
              <Cabecalho
                titulo="Tudo pronto para a primeira venda"
                texto="O que ficou para trás continua disponível em Configurações. Ao concluir, este roteiro não aparece mais."
              />
              <section className="placa p-5">
                <ul className="space-y-2 text-sm">
                  <Resumo ok={ticket.store_name.trim().length >= 2}>
                    Loja: {ticket.store_name || "sem nome"}
                    {ticket.city ? ` · ${ticket.city}` : ""}
                  </Resumo>
                  <Resumo ok>Cupom: {ticket.fiscal_label || "sem título"}</Resumo>
                  <Resumo ok={(produtos ?? 0) > 0}>
                    Catálogo: {produtos ? `${produtos} produto(s)` : "vazio, cadastre em Estoque"}
                  </Resumo>
                  <Resumo ok>Backup automático diário já ligado nesta máquina</Resumo>
                </ul>
                <p className="mt-4 text-xs text-muted-foreground">
                  Anote a senha do master em lugar seguro: sem internet, não existe recuperação.
                </p>
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="trilho flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Button variant="ghost" className="h-11 rounded-sm px-4 text-muted-foreground" onClick={adiar} disabled={busy}>
          Deixar para depois
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="campo h-11 rounded-sm px-4"
            onClick={() => ir(-1)}
            disabled={busy || indice === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Voltar
          </Button>
          {passo === "pronto" ? (
            <Button
              variant="ghost"
              className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
              style={{ fontFamily: "var(--font-display)" }}
              onClick={concluir}
              disabled={busy}
            >
              <Check className="mr-2 h-4 w-4" aria-hidden /> Concluir
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
              style={{ fontFamily: "var(--font-display)" }}
              onClick={passo === "loja" || passo === "cupom" ? salvarTicketEAvancar : () => ir(1)}
              disabled={busy}
            >
              {passo === "loja" || passo === "cupom" ? "Salvar e avançar" : "Avançar"}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Cabecalho({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <h2 className="text-xl">{titulo}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

function Marcador({
  id,
  rotulo,
  ligado,
  onChange,
}: {
  id: string;
  rotulo: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 border border-border p-2.5">
      <input
        id={id}
        type="checkbox"
        className="marcador"
        checked={ligado}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm">{rotulo}</span>
    </label>
  );
}

function Resumo({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center border text-[11px]"
        style={{
          borderColor: ok ? "var(--success)" : "var(--warning)",
          color: ok ? "var(--success)" : "var(--warning)",
        }}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <span>{children}</span>
    </li>
  );
}

function ParametroLinha({
  param,
  onSalvar,
}: {
  param: SystemParam;
  onSalvar: (p: SystemParam, valor: string) => void;
}) {
  const [rascunho, setRascunho] = useState(param.value);
  useEffect(() => {
    setRascunho(param.value);
  }, [param.value]);

  if (param.tipo === "booleano") {
    return (
      <label className="flex cursor-pointer items-start gap-3 border-b border-border/60 py-3 last:border-b-0">
        <input
          type="checkbox"
          checked={param.value === "1"}
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
        <label htmlFor={`ai-${param.key}`} className="block text-sm font-medium">
          {param.rotulo}
        </label>
        {param.descricao && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{param.descricao}</p>
        )}
      </div>
      <input
        id={`ai-${param.key}`}
        value={rascunho}
        inputMode={param.tipo === "inteiro" ? "numeric" : "text"}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => rascunho !== param.value && onSalvar(param, rascunho)}
        className="campo num h-11 w-24 shrink-0 rounded-sm px-3 text-right text-lg font-semibold"
      />
    </div>
  );
}

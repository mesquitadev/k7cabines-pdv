import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CreditCard,
  LockKeyhole,
  QrCode,
  Unlock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoMoeda } from "@/components/campo-moeda";
import { avisoDeTurnoAntigo } from "@/lib/turno";
import { VendasDoTurno } from "@/components/vendas-do-turno";
import type { LocalVendasDoTurno } from "@/lib/desktop";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import {
  desktop,
  isDesktop,
  type CashMovementInfo,
  type CashSession,
  type CashSessionSummary,
} from "@/lib/desktop";
import { Numeros, Rotulo } from "@/components/placa";
import { dinheiro } from "@/lib/placa";
import { cn } from "@/lib/utils";
import { Ajuda } from "@/components/ajuda";

export const Route = createFileRoute("/_app/caixa")({
  ssr: false,
  head: () => ({ meta: [{ title: "Caixa — Turno" }] }),
  component: CaixaPage,
});

const paraCentavos = (valor: string) => Math.round((parseFloat(valor || "0") || 0) * 100);

function CaixaPage() {
  const { session, pode } = useAuth();
  const podeFechar = pode("cash.manage");
  const token = session && "token" in session ? session.token : null;

  const [sessao, setSessao] = useState<CashSession | null>(null);
  const avisoTurno = avisoDeTurnoAntigo(sessao);
  const [viradaAberta, setViradaAberta] = useState(false);
  const [motivoVirada, setMotivoVirada] = useState("");
  const [resumo, setResumo] = useState<CashSessionSummary | null>(null);
  const [movimentos, setMovimentos] = useState<CashMovementInfo[]>([]);
  const [vendas, setVendas] = useState<LocalVendasDoTurno | null>(null);
  const [busy, setBusy] = useState(false);

  const [abrirAberto, setAbrirAberto] = useState(false);
  const [fundo, setFundo] = useState(0);
  const [movAberto, setMovAberto] = useState<null | "sangria" | "suprimento">(null);
  const [valorMov, setValorMov] = useState(0);
  const [motivoMov, setMotivoMov] = useState("");
  const [fecharAberto, setFecharAberto] = useState(false);
  const [contado, setContado] = useState(0);
  const [notas, setNotas] = useState("");

  const carregar = useCallback(async () => {
    if (!token || !isDesktop()) return;
    try {
      const atual = await desktop.cashOpenSession(token);
      setSessao(atual);
      if (atual) {
        const [r, m, v] = await Promise.all([
          desktop.cashSummary(token, atual.id),
          desktop.cashMovements(token, atual.id),
          // Sem permissão de fechamento o detalhamento é negado; a tela do
          // operador continua funcionando sem ele.
          desktop.cashSessionSales(token, atual.id).catch(() => null),
        ]);
        setResumo(r);
        setMovimentos(m);
        setVendas(v);
      } else {
        setResumo(null);
        setMovimentos([]);
        setVendas(null);
      }
    } catch {
      setSessao(null);
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const executar = async (acao: () => Promise<unknown>, sucesso: string) => {
    setBusy(true);
    try {
      await acao();
      toast.success(sucesso);
      await carregar();
      return true;
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível concluir");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const abrir = async () => {
    if (!token) return;
    const ok = await executar(
      () => desktop.cashOpen(token, fundo),
      "Turno aberto",
    );
    if (ok) {
      setAbrirAberto(false);
      setFundo(0);
    }
  };

  const movimentar = async () => {
    if (!token || !movAberto) return;
    const ok = await executar(
      () => desktop.cashMove(token, movAberto, valorMov, motivoMov),
      movAberto === "sangria" ? "Sangria registrada" : "Suprimento registrado",
    );
    if (ok) {
      setMovAberto(null);
      setValorMov(0);
      setMotivoMov("");
    }
  };

  const fechar = async () => {
    if (!token) return;
    const ok = await executar(
      () => desktop.cashClose(token, contado, notas || null),
      "Turno fechado",
    );
    if (ok) {
      setFecharAberto(false);
      setContado(0);
      setNotas("");
    }
  };

  /**
   * Encerra o turno esquecido e abre o de hoje numa operação só.
   *
   * O Rust faz as duas coisas na mesma transação: encerrar sem abrir deixaria
   * a loja sem poder vender.
   */
  const virarDia = async () => {
    if (!token) return;
    const ok = await executar(
      () => desktop.cashRollover(token, motivoVirada.trim()),
      "Turno de ontem encerrado sem contagem. Turno de hoje aberto.",
    );
    if (ok) {
      setViradaAberta(false);
      setMotivoVirada("");
    }
  };

  const diferencaPrevia = resumo ? contado - resumo.esperado_cents : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-4 pb-3 pt-4 sm:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-3xl">
            Turno
            <Ajuda lado="right">
              O turno é o período entre abrir e fechar a gaveta — do dia, não da pessoa. Pode
              trocar de operador no meio, e quem fecha não precisa ser quem abriu. Ele existe para
              conferir, no fim do dia, se o dinheiro que deveria estar lá está de fato. Cartão e
              PIX não entram nessa conta: não passam pela gaveta.
            </Ajuda>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Confere se o dinheiro que deveria estar na gaveta está lá.
            {sessao
              ? ` Aberto por ${sessao.opened_by_name} às ${new Date(sessao.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
              : " Nenhum turno aberto."}
          </p>
          {avisoTurno && (
            <div
              className="mt-2 max-w-2xl border p-3"
              style={{
                borderColor: "var(--warning)",
                background: "color-mix(in oklab, var(--warning) 12%, transparent)",
              }}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{ color: "var(--warning)" }}
                  aria-hidden
                />
                <span className="text-sm leading-relaxed">{avisoTurno}</span>
              </div>
              {podeFechar && (
                <div className="mt-3 flex flex-wrap gap-2 pl-6">
                  <Button
                    variant="ghost"
                    className="acao-receber h-11 rounded-sm px-4 text-xs font-bold uppercase"
                    onClick={() => setFecharAberto(true)}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Contar a gaveta e fechar
                  </Button>
                  <Button
                    variant="outline"
                    className="campo h-11 rounded-sm px-4 text-xs"
                    onClick={() => setViradaAberta(true)}
                  >
                    Encerrar sem contar e abrir hoje
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!sessao ? (
            <Button
              onClick={() => setAbrirAberto(true)}
              variant="ghost"
              className="acao-receber h-12 rounded-sm px-5 font-bold uppercase"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <Unlock className="mr-2 h-4 w-4" aria-hidden /> Abrir turno
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-12 rounded-sm"
                onClick={() => setMovAberto("suprimento")}
              >
                <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden /> Suprimento
              </Button>
              <Button
                variant="outline"
                className="h-12 rounded-sm"
                onClick={() => setMovAberto("sangria")}
              >
                <ArrowUpFromLine className="mr-2 h-4 w-4" aria-hidden /> Sangria
              </Button>
              <Button
                variant="ghost"
                className="acao-destrutiva h-12 rounded-sm px-5 font-bold uppercase"
                style={{ fontFamily: "var(--font-display)" }}
                onClick={() => setFecharAberto(true)}
              >
                <LockKeyhole className="mr-2 h-4 w-4" aria-hidden /> Fechar turno
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        {!sessao ? (
          <div className="placa flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <Rotulo>Turno fechado</Rotulo>
            <p className="max-w-md text-sm text-muted-foreground">
              Abra o turno informando o fundo de troco para começar a vender. Toda venda fica
              amarrada ao turno em que foi feita.
            </p>
          </div>
        ) : (
          <>
            {/* O número que interessa: quanto deveria estar na gaveta agora. */}
            <div className="placa mb-4 flex flex-wrap items-end justify-between gap-6 p-5">
              <div>
                <Rotulo className="flex items-center gap-1.5">
                  Esperado na gaveta
                  <Ajuda>
                    Fundo de troco, mais o dinheiro recebido, menos o troco devolvido, mais
                    suprimentos, menos sangrias e estornos em espécie.
                  </Ajuda>
                </Rotulo>
                <Numeros
                  valor={dinheiro((resumo?.esperado_cents ?? 0) / 100)}
                  className="mt-1 block text-[3rem] font-bold leading-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
                <Verba rotulo="Fundo" valor={resumo?.opening_float_cents ?? 0} />
                <Verba rotulo="Dinheiro" valor={resumo?.cash_cents ?? 0} icone={<Banknote className="h-3.5 w-3.5" />} />
                <Verba rotulo="Suprimentos" valor={resumo?.deposits_cents ?? 0} />
                <Verba rotulo="Sangrias" valor={-(resumo?.withdrawals_cents ?? 0)} />
              </div>
            </div>

            {/* Recebimentos por forma: não entram na gaveta, mas fecham o turno. */}
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Cartao rotulo="Dinheiro" valor={resumo?.cash_cents ?? 0} icone={<Banknote className="h-4 w-4" />} />
              <Cartao rotulo="Maquininha" valor={resumo?.card_cents ?? 0} icone={<CreditCard className="h-4 w-4" />} />
              {/* Só em turno que tenha venda antiga com PIX. */}
              {(resumo?.pix_cents ?? 0) > 0 && (
                <Cartao rotulo="PIX" valor={resumo?.pix_cents ?? 0} icone={<QrCode className="h-4 w-4" />} />
              )}
            </div>

            <div className="placa mb-4 flex flex-wrap items-center justify-between gap-4 px-5 py-3">
              <span className="flex items-baseline gap-2">
                <Rotulo>Vendas no turno</Rotulo>
                <span className="num text-xl font-bold">{resumo?.sales_count ?? 0}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <Rotulo>Total vendido</Rotulo>
                <span className="num text-xl font-bold">
                  {dinheiro((resumo?.total_sales_cents ?? 0) / 100)}
                </span>
              </span>
              {(resumo?.refunds_cash_cents ?? 0) > 0 && (
                <span className="flex items-baseline gap-2">
                  <Rotulo>Estornos em dinheiro</Rotulo>
                  <span className="num text-xl font-bold" style={{ color: "var(--destructive)" }}>
                    −{dinheiro((resumo?.refunds_cash_cents ?? 0) / 100)}
                  </span>
                </span>
              )}
            </div>

            {/* O que saiu, antes do que entrou de sangria: é a pergunta que
                o gerente faz primeiro ao fechar. */}
            {vendas && <VendasDoTurno vendas={vendas} />}

            <div className="painel overflow-hidden">
              <div className="border-b border-border px-4 py-2.5">
                <Rotulo>Movimentos do turno</Rotulo>
              </div>
              {movimentos.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhuma sangria ou suprimento neste turno.
                </p>
              ) : (
                <ul>
                  {movimentos.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {m.kind === "sangria" ? (
                          <ArrowUpFromLine className="h-4 w-4 shrink-0" style={{ color: "var(--warning)" }} aria-hidden />
                        ) : (
                          <ArrowDownToLine className="h-4 w-4 shrink-0" style={{ color: "var(--success)" }} aria-hidden />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{m.reason}</div>
                          <div className="rotulo text-[10px] text-muted-foreground">
                            {m.actor_name} ·{" "}
                            {new Date(m.occurred_at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </div>
                      <span
                        className="num shrink-0 text-lg font-bold"
                        style={{ color: m.kind === "sangria" ? "var(--warning)" : "var(--success)" }}
                      >
                        {m.kind === "sangria" ? "−" : "+"}
                        {dinheiro(m.amount_cents / 100)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/*
        Virada de dia: encerra o turno esquecido sem inventar contagem e abre o
        de hoje com o dinheiro que continua na gaveta.
      */}
      <Dialog open={viradaAberta} onOpenChange={setViradaAberta}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Encerrar sem contar e abrir hoje</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  O turno de {sessao && new Date(sessao.opened_at).toLocaleDateString("pt-BR")}{" "}
                  será encerrado <strong>sem conferência</strong>: o sistema grava quanto era
                  esperado na gaveta, mas <strong>não registra diferença</strong>, porque ninguém
                  contou.
                </p>
                <p>
                  Em seguida abre um turno novo com{" "}
                  <strong className="num">
                    {dinheiro((resumo?.esperado_cents ?? 0) / 100)}
                  </strong>{" "}
                  de fundo — o dinheiro continua fisicamente na gaveta.
                </p>
                <p style={{ color: "var(--warning)" }}>
                  O turno encerrado aparece marcado no relatório de Fechamento. Se ainda dá tempo
                  de contar a gaveta, prefira fechar direito.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="motivoVirada">Por que não foi contado?</Label>
            <Input
              id="motivoVirada"
              autoFocus
              value={motivoVirada}
              onChange={(e) => setMotivoVirada(e.target.value)}
              placeholder="Ex.: esqueceram de fechar na sexta"
              className="campo h-11 rounded-sm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-12 rounded-sm"
              onClick={() => setViradaAberta(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-destrutiva h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy || motivoVirada.trim().length < 3}
              onClick={virarDia}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Encerrar e abrir hoje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Abertura */}
      <Dialog open={abrirAberto} onOpenChange={setAbrirAberto}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Abrir turno</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <CampoMoeda
              id="fundo"
              rotulo="Fundo de troco"
              grande
              autoFocus
              centavos={fundo}
              onChange={setFundo}
            />
            <p className="text-xs text-muted-foreground">
              Dinheiro que já está na gaveta antes da primeira venda. É a base da conferência no
              fechamento.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setAbrirAberto(false)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy}
              onClick={abrir}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Abrindo…" : "Abrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sangria e suprimento */}
      <Dialog open={!!movAberto} onOpenChange={(o) => !o && setMovAberto(null)}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {movAberto === "sangria" ? "Sangria" : "Suprimento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {movAberto === "sangria"
                ? "Retirada de dinheiro da gaveta. Não pode ser maior do que o esperado."
                : "Reforço de dinheiro na gaveta, normalmente para troco."}
            </p>
            <div className="space-y-1.5">
              <CampoMoeda
                id="valorMov"
                rotulo="Valor"
                grande
                autoFocus
                centavos={valorMov}
                onChange={setValorMov}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="motivoMov">Motivo</Label>
              <Input
                id="motivoMov"
                value={motivoMov}
                onChange={(e) => setMotivoMov(e.target.value)}
                placeholder={movAberto === "sangria" ? "Malote, pagamento…" : "Troco, reforço…"}
                className="h-12 rounded-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setMovAberto(null)}>
              Cancelar
            </Button>
            <Button
              className="h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy || !motivoMov.trim()}
              onClick={movimentar}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fechamento conferido */}
      <Dialog open={fecharAberto} onOpenChange={setFecharAberto}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Fechar turno</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-end justify-between border-b border-border pb-3">
              <Rotulo>Esperado na gaveta</Rotulo>
              <span className="num text-3xl font-bold">
                {dinheiro((resumo?.esperado_cents ?? 0) / 100)}
              </span>
            </div>

            <div className="space-y-1.5">
              <CampoMoeda
                id="contado"
                rotulo="Contado na gaveta"
                grande
                autoFocus
                centavos={contado}
                onChange={setContado}
              />
            </div>

            {contado > 0 && (
              <div
                className="flex items-center justify-between border p-4"
                style={{
                  borderColor:
                    diferencaPrevia === 0
                      ? "var(--success)"
                      : diferencaPrevia < 0
                        ? "var(--destructive)"
                        : "var(--warning)",
                  background:
                    diferencaPrevia === 0
                      ? "color-mix(in oklab, var(--success) 14%, transparent)"
                      : diferencaPrevia < 0
                        ? "color-mix(in oklab, var(--destructive) 14%, transparent)"
                        : "color-mix(in oklab, var(--warning) 14%, transparent)",
                }}
              >
                <Rotulo
                  className="text-[13px]"
                  style={{
                    color:
                      diferencaPrevia === 0
                        ? "var(--success)"
                        : diferencaPrevia < 0
                          ? "var(--destructive)"
                          : "var(--warning)",
                  }}
                >
                  {diferencaPrevia === 0 ? "Confere" : diferencaPrevia < 0 ? "Falta" : "Sobra"}
                </Rotulo>
                <Numeros
                  valor={dinheiro(Math.abs(diferencaPrevia) / 100)}
                  className="text-3xl font-bold leading-none"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="notas">Observação (opcional)</Label>
              <Input
                id="notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Conferido a dois, diferença justificada…"
                className="h-12 rounded-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setFecharAberto(false)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-destrutiva h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy || contado <= 0}
              onClick={fechar}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Fechando…" : "Fechar turno"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Verba({ rotulo, valor, icone }: { rotulo: string; valor: number; icone?: React.ReactNode }) {
  return (
    <div>
      <Rotulo className="flex items-center gap-1.5">
        {icone}
        {rotulo}
      </Rotulo>
      <div
        className={cn("num mt-0.5 text-lg font-bold")}
        style={{ color: valor < 0 ? "var(--warning)" : undefined }}
      >
        {valor < 0 ? "−" : ""}
        {dinheiro(Math.abs(valor) / 100)}
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, icone }: { rotulo: string; valor: number; icone: React.ReactNode }) {
  return (
    <div className="placa flex items-center justify-between gap-3 p-4">
      <Rotulo className="flex items-center gap-2">
        {icone}
        {rotulo}
      </Rotulo>
      <span className="num text-xl font-bold">{dinheiro(valor / 100)}</span>
    </div>
  );
}

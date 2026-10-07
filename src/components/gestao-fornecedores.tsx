import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, History, Pencil, Plus, Power, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BotaoAcao } from "@/components/botao-acao";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { Rotulo } from "@/components/placa";
import {
  desktop,
  desktopToken,
  type LocalSupplier,
  type LocalSupplierPurchase,
} from "@/lib/desktop";
import { checarDocumento, formatarDocumento, formatarTelefone } from "@/lib/documento";
import { cn } from "@/lib/utils";

const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const VAZIO = { name: "", document: "", phone: "", email: "", notes: "" };

/**
 * Fornecedores: quem abastece a loja, e o histórico do que se comprou de cada um.
 *
 * O cadastro é magro de propósito. O que dá valor não são os campos, é o
 * vínculo: a entrada de estoque grava de quem veio e por quanto, então
 * "o custo subiu" vira "subiu na compra do dia 12, com a Alfa".
 */
export function GestaoFornecedores({ podeGerir }: { podeGerir: boolean }) {
  const [fornecedores, setFornecedores] = useState<LocalSupplier[]>([]);
  const [editando, setEditando] = useState<LocalSupplier | null>(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [historico, setHistorico] = useState<{
    fornecedor: LocalSupplier;
    compras: LocalSupplierPurchase[];
  } | null>(null);

  const carregar = useCallback(async () => {
    const token = desktopToken();
    if (!token) return;
    try {
      setFornecedores(await desktop.listSuppliers(token));
    } catch {
      setFornecedores([]);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const checagem = useMemo(() => checarDocumento(form.document), [form.document]);

  const abrirNovo = () => {
    setForm(VAZIO);
    setEditando(null);
    setCriando(true);
  };

  const abrirEdicao = (f: LocalSupplier) => {
    setForm({
      name: f.name,
      document: formatarDocumento(f.document),
      phone: f.phone,
      email: f.email,
      notes: f.notes,
    });
    setEditando(f);
  };

  const fechar = () => {
    setCriando(false);
    setEditando(null);
  };

  const salvar = async () => {
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    if (form.name.trim().length < 2) return toast.error("Informe o nome do fornecedor");
    if (checagem.estado === "erro") return toast.error(checagem.mensagem);

    const dados = {
      name: form.name.trim(),
      document: checagem.estado === "ok" ? checagem.digitos : null,
      phone: form.phone.trim(),
      email: form.email.trim(),
      notes: form.notes.trim(),
    };

    setSalvando(true);
    try {
      if (editando) {
        await desktop.updateSupplier(token, editando.id, dados);
        toast.success("Fornecedor atualizado");
      } else {
        await desktop.createSupplier(token, dados);
        toast.success("Fornecedor cadastrado");
      }
      fechar();
      await carregar();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  };

  const alternarAtivo = async (f: LocalSupplier) => {
    const token = desktopToken();
    if (!token) return;
    try {
      if (f.active) {
        await desktop.deactivateSupplier(token, f.id);
        toast.success(`${f.name} desativado`);
      } else {
        await desktop.reactivateSupplier(token, f.id);
        toast.success(`${f.name} reativado`);
      }
      await carregar();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível alterar");
    }
  };

  const verHistorico = async (f: LocalSupplier) => {
    const token = desktopToken();
    if (!token) return;
    try {
      setHistorico({ fornecedor: f, compras: await desktop.supplierPurchases(token, f.id) });
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível abrir o histórico");
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          De quem a loja compra. O fornecedor escolhido na entrada de estoque fica gravado naquela
          compra, mesmo que o produto mude de fornecedor depois.
        </p>
        {podeGerir && (
          <Button
            onClick={abrirNovo}
            variant="ghost"
            className="acao-receber h-11 shrink-0 rounded-sm px-4 font-bold uppercase"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo fornecedor
          </Button>
        )}
      </div>

      <div className="painel divide-y divide-border overflow-hidden">
        {fornecedores.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Nenhum fornecedor cadastrado ainda.
          </p>
        ) : (
          fornecedores.map((f) => (
            <div
              key={f.id}
              className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !f.active && "opacity-45")}
            >
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-[12rem] flex-1">
                <div className="font-semibold">{f.name}</div>
                <div className="rotulo num text-[10px] text-muted-foreground">
                  {f.document ? formatarDocumento(f.document) : "sem documento"}
                  {f.phone && ` · ${formatarTelefone(f.phone)}`}
                  {` · ${f.product_count} produto(s)`}
                  {!f.active && " · desativado"}
                </div>
              </div>

              <div className="min-w-[8rem] text-right">
                <Rotulo className="block">Última compra</Rotulo>
                <span className="num text-xs text-muted-foreground">
                  {f.last_purchase_at ? dataHora(f.last_purchase_at) : "—"}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <BotaoAcao rotulo="Histórico de compras" onClick={() => verHistorico(f)}>
                  <History className="h-4 w-4" />
                </BotaoAcao>
                {podeGerir && (
                  <>
                    <BotaoAcao rotulo="Editar fornecedor" onClick={() => abrirEdicao(f)}>
                      <Pencil className="h-4 w-4" />
                    </BotaoAcao>
                    <BotaoAcao
                      rotulo={f.active ? "Desativar fornecedor" : "Reativar fornecedor"}
                      destrutivo={f.active}
                      onClick={() => alternarAtivo(f)}
                    >
                      {f.active ? <Power className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                    </BotaoAcao>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <PainelLateral
        aberto={criando || !!editando}
        onAbertoMudou={(a) => !a && fechar()}
        icone={Building2}
        titulo={editando ? "Editar fornecedor" : "Novo fornecedor"}
        descricao={editando ? `${editando.product_count} produto(s) apontam para este` : undefined}
        largura="sm:max-w-lg"
        confirmarDescarte={form.name.trim().length > 0}
        rodape={
          <>
            <Button variant="outline" className="h-11 rounded-sm px-5" onClick={fechar}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
              disabled={salvando || form.name.trim().length < 2}
              onClick={salvar}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </>
        }
      >
        <SecaoForm titulo="Identificação">
          <div className="space-y-1.5">
            <Label htmlFor="fnome">Nome ou razão social</Label>
            <Input
              id="fnome"
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Distribuidora Alfa"
              className="campo h-11 rounded-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fdoc">CNPJ ou CPF</Label>
            <Input
              id="fdoc"
              inputMode="numeric"
              value={form.document}
              onChange={(e) => setForm({ ...form, document: e.target.value })}
              onBlur={() =>
                setForm((f) => ({ ...f, document: formatarDocumento(f.document) || f.document }))
              }
              placeholder="Opcional"
              aria-invalid={checagem.estado === "erro"}
              className={cn(
                "campo num h-11 rounded-sm",
                checagem.estado === "erro" && "border-destructive",
              )}
            />
            {checagem.estado === "erro" ? (
              <p className="text-xs text-destructive">{checagem.mensagem}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {checagem.estado === "ok"
                  ? `${checagem.tipo} válido.`
                  : "Opcional: muito distribuidor pequeno não emite nota."}
              </p>
            )}
          </div>
        </SecaoForm>

        <SecaoForm titulo="Contato">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ftel">Telefone</Label>
              <Input
                id="ftel"
                inputMode="tel"
                value={formatarTelefone(form.phone)}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(21) 98888-7777"
                className="campo num h-11 rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fmail">E-mail</Label>
              <Input
                id="fmail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="campo h-11 rounded-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fobs">Observação</Label>
            <Input
              id="fobs"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Ex.: entrega às terças, pedido mínimo R$ 300"
              className="campo h-11 rounded-sm"
            />
          </div>
        </SecaoForm>
      </PainelLateral>

      <PainelLateral
        aberto={!!historico}
        onAbertoMudou={(a) => !a && setHistorico(null)}
        icone={History}
        titulo="Histórico de compras"
        descricao={historico?.fornecedor.name}
        largura="sm:max-w-xl"
      >
        {historico?.compras.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma entrada registrada com este fornecedor ainda. Escolha-o ao registrar uma
            entrada de estoque para o histórico começar.
          </p>
        ) : (
          <div className="painel divide-y divide-border overflow-hidden">
            {historico?.compras.map((c, i) => (
              <div key={`${c.occurred_at}-${i}`} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {c.variant_name ? `${c.product_name} · ${c.variant_name}` : c.product_name}
                  </span>
                  <span className="num text-sm">
                    {c.quantity} ×{" "}
                    {c.unit_cost_cents == null ? "sem custo" : fmt(c.unit_cost_cents)}
                  </span>
                </div>
                <div className="rotulo num mt-0.5 text-[10px] text-muted-foreground">
                  {dataHora(c.occurred_at)} · {c.actor_name}
                  {c.reason && c.reason !== "stock.add" && ` · ${c.reason}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </PainelLateral>
    </div>
  );
}

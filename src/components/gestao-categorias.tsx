import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, FolderPlus, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BotaoAcao } from "@/components/botao-acao";
import { Rotulo } from "@/components/placa";
import { useConfirmacao } from "@/components/confirmacao";
import { desktop, desktopToken, type LocalCategory } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/** As cores disponíveis são as linhas do sistema: uma cor, um significado. */
const CORES = [
  { valor: "var(--linha-pulseira)", nome: "Vermelho" },
  { valor: "var(--linha-bebida)", nome: "Cobalto" },
  { valor: "var(--linha-erotico)", nome: "Violeta" },
  { valor: "var(--linha-outro)", nome: "Turquesa" },
];

export function GestaoCategorias({
  podeCriar,
  podeEditar,
  podeDesativar,
  onMudou,
}: {
  podeCriar: boolean;
  podeEditar: boolean;
  podeDesativar: boolean;
  onMudou?: () => void;
}) {
  const [categorias, setCategorias] = useState<LocalCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [editando, setEditando] = useState<LocalCategory | null>(null);
  const [criandoEm, setCriandoEm] = useState<LocalCategory | null | "raiz">(null);
  const [form, setForm] = useState({ name: "", color: CORES[3].valor, sort_order: 10, highlight: false });
  const confirmar = useConfirmacao();

  const carregar = useCallback(async () => {
    const token = desktopToken();
    if (!token) return;
    try {
      setCategorias(await desktop.listCategories(token));
    } catch {
      setCategorias([]);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /** Árvore de dois níveis: categoria e suas subcategorias. */
  const arvore = useMemo(() => {
    const raizes = categorias.filter((c) => !c.parent_id);
    return raizes.map((raiz) => ({
      raiz,
      filhas: categorias.filter((c) => c.parent_id === raiz.id),
    }));
  }, [categorias]);

  const abrirNova = (pai: LocalCategory | null) => {
    setCriandoEm(pai ?? "raiz");
    setForm({
      name: "",
      color: pai ? "" : CORES[3].valor,
      sort_order: pai ? 100 : (categorias.filter((c) => !c.parent_id).length + 1) * 10,
      highlight: false,
    });
  };

  const abrirEdicao = (c: LocalCategory) => {
    setEditando(c);
    setForm({ name: c.name, color: c.color, sort_order: c.sort_order, highlight: c.highlight ?? false });
  };

  const salvar = async () => {
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    setBusy(true);
    try {
      if (editando) {
        await desktop.updateCategory(token, editando.id, {
          name: form.name,
          color: form.color,
          sort_order: form.sort_order,
          highlight: form.highlight,
        });
        toast.success("Categoria atualizada");
      } else {
        const pai = criandoEm === "raiz" ? null : criandoEm;
        await desktop.createCategory(token, {
          name: form.name,
          parent_id: pai?.id ?? null,
          color: form.color,
          sort_order: form.sort_order,
          highlight: form.highlight,
        });
        toast.success(pai ? "Subcategoria criada" : "Categoria criada");
      }
      setEditando(null);
      setCriandoEm(null);
      await carregar();
      onMudou?.();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  };

  const desativar = async (c: LocalCategory) => {
    const token = desktopToken();
    if (!token) return;
    setBusy(true);
    try {
      await desktop.deactivateCategory(token, c.id);
      toast.success(`${c.name} desativada`);
      await carregar();
      onMudou?.();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível desativar");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Exclusão de verdade, quando ninguém aponta para a categoria.
   *
   * Desativar existe para o caso oposto: categoria com histórico não pode
   * sumir, senão o relatório antigo fica sem o nome dela. O Rust recusa e a
   * mensagem diz o porquê, então aqui é só pedir a confirmação.
   */
  const excluir = async (c: LocalCategory) => {
    const token = desktopToken();
    if (!token) return;
    const ok = await confirmar({
      titulo: `Excluir ${c.name}?`,
      descricao:
        "A categoria some do sistema para sempre. Só é possível quando nenhum produto, nem excluído, aponta para ela — caso contrário, desative.",
      acao: "Excluir categoria",
      destrutivo: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await desktop.deleteCategory(token, c.id);
      toast.success(`${c.name} excluída`);
      await carregar();
      onMudou?.();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível excluir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          A cor vale no caixa, no estoque e nos relatórios. A ordem define quem aparece primeiro
          no catálogo do caixa.
        </p>
        {podeCriar && (
          <Button
            onClick={() => abrirNova(null)}
            variant="ghost"
            className="acao-receber h-11 shrink-0 rounded-sm px-4 font-bold uppercase"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Nova categoria
          </Button>
        )}
      </div>

      <div className="painel overflow-hidden">
        {arvore.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Nenhuma categoria ainda.
          </p>
        ) : (
          arvore.map(({ raiz, filhas }) => (
            <div key={raiz.id} className="border-b border-border last:border-b-0">
              <div
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-3",
                  !raiz.active && "opacity-45",
                )}
              >
                <span
                  aria-hidden
                  className="h-6 w-1.5 shrink-0"
                  style={{ background: raiz.color || "var(--linha-outro)" }}
                />
                <div className="min-w-[10rem] flex-1">
                  <div className="font-semibold">{raiz.name}</div>
                  <div className="rotulo num text-[10px] text-muted-foreground">
                    ordem {raiz.sort_order} · {raiz.product_count} produto(s)
                    {!raiz.active && " · desativada"}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {podeCriar && (
                    <BotaoAcao rotulo="Nova subcategoria" onClick={() => abrirNova(raiz)}>
                      <FolderPlus className="h-4 w-4" />
                    </BotaoAcao>
                  )}
                  {podeEditar && (
                    <BotaoAcao rotulo="Editar categoria" onClick={() => abrirEdicao(raiz)}>
                      <Pencil className="h-4 w-4" />
                    </BotaoAcao>
                  )}
                  {podeDesativar && raiz.active && (
                    <BotaoAcao rotulo="Desativar categoria" onClick={() => desativar(raiz)}>
                      <Power className="h-4 w-4" />
                    </BotaoAcao>
                  )}
                  {podeDesativar && (
                    <BotaoAcao
                      rotulo={
                        raiz.product_count > 0
                          ? `Não dá para excluir: ${raiz.product_count} produto(s) usam esta categoria`
                          : "Excluir categoria"
                      }
                      destrutivo
                      disabled={raiz.product_count > 0 || filhas.length > 0}
                      onClick={() => excluir(raiz)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </BotaoAcao>
                  )}
                </div>
              </div>

              {filhas.map((f) => (
                <div
                  key={f.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 border-t border-border/60 py-2 pl-10 pr-4",
                    !f.active && "opacity-45",
                  )}
                >
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-[8rem] flex-1">
                    <div className="text-sm">{f.name}</div>
                    <div className="rotulo num text-[10px] text-muted-foreground">
                      {f.product_count} produto(s){!f.active && " · desativada"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {podeEditar && (
                      <BotaoAcao rotulo="Editar subcategoria" onClick={() => abrirEdicao(f)}>
                        <Pencil className="h-4 w-4" />
                      </BotaoAcao>
                    )}
                    {podeDesativar && f.active && (
                      <BotaoAcao rotulo="Desativar subcategoria" onClick={() => desativar(f)}>
                        <Power className="h-4 w-4" />
                      </BotaoAcao>
                    )}
                    {podeDesativar && (
                      <BotaoAcao
                        rotulo={
                          f.product_count > 0
                            ? `Não dá para excluir: ${f.product_count} produto(s) usam esta subcategoria`
                            : "Excluir subcategoria"
                        }
                        destrutivo
                        disabled={f.product_count > 0}
                        onClick={() => excluir(f)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </BotaoAcao>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <Dialog
        open={!!editando || !!criandoEm}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setCriandoEm(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {editando
                ? "Editar categoria"
                : criandoEm && criandoEm !== "raiz"
                  ? `Nova subcategoria de ${criandoEm.name}`
                  : "Nova categoria"}
            </DialogTitle>
            {editando && (
              <DialogDescription>
                Renomear corrige o nome em todos os {editando.product_count} produto(s) de uma vez.
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nomeCat">Nome</Label>
              <Input
                id="nomeCat"
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-12 rounded-sm"
              />
            </div>

            {/* Subcategoria herda a cor da categoria: uma cor, um significado. */}
            {(editando ? !editando.parent_id : criandoEm === "raiz") && (
              <>
                <div className="space-y-1.5">
                  <Rotulo>Cor da linha</Rotulo>
                  <div className="flex flex-wrap gap-2">
                    {CORES.map((c) => (
                      <button
                        key={c.valor}
                        type="button"
                        onClick={() => setForm({ ...form, color: c.valor })}
                        aria-pressed={form.color === c.valor}
                        className={cn(
                          "rotulo flex h-11 items-center gap-2 border px-3 text-[11px] transition-colors",
                          form.color === c.valor
                            ? "border-transparent bg-secondary text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <span aria-hidden className="h-3 w-5" style={{ background: c.valor }} />
                        {c.nome}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ordem">Ordem no caixa</Label>
                  <Input
                    id="ordem"
                    type="number"
                    min="0"
                    step="10"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })}
                    className="num h-12 w-28 rounded-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Menor aparece primeiro. Pulseiras costuma ser 0 e Eróticos, 20.
                  </p>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 border border-border p-2.5">
                  <input
                    type="checkbox"
                    className="marcador mt-0.5 shrink-0"
                    checked={form.highlight}
                    onChange={(e) => setForm({ ...form, highlight: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">Piscar na venda</span>
                    <span className="block text-xs text-muted-foreground">
                      Todos os produtos desta categoria fazem a tela do caixa piscar em vermelho e
                      branco, como a pulseira.
                    </span>
                  </span>
                </label>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="h-12 rounded-sm"
              onClick={() => {
                setEditando(null);
                setCriandoEm(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy || form.name.trim().length < 2}
              onClick={salvar}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

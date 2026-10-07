import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
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
import { DrawerPerfil } from "@/components/drawer-perfil";
import { useAuth } from "@/lib/auth-context";
import {
  desktop,
  isDesktop,
  type LocalPermissionInfo,
  type LocalRole,
  type LocalRoleInfo,
  type ManagedUser,
} from "@/lib/desktop";
import { Rotulo } from "@/components/placa";
import { cn } from "@/lib/utils";
import { BotaoAcao } from "@/components/botao-acao";


const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function GestaoUsuarios() {
  const { session, profile } = useAuth();
  const token = session && "token" in session ? session.token : null;
  const podeGerir = profile?.access_usuarios ?? false;

  const [usuarios, setUsuarios] = useState<ManagedUser[]>([]);
  const [papeis, setPapeis] = useState<LocalRoleInfo[]>([]);
  const [catalogo, setCatalogo] = useState<LocalPermissionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const [novoAberto, setNovoAberto] = useState(false);
  const [perfilEditando, setPerfilEditando] = useState<LocalRoleInfo | null>(null);
  const [criandoPerfil, setCriandoPerfil] = useState(false);
  const [form, setForm] = useState({
    username: "",
    full_name: "",
    whatsapp: "",
    password: "",
    role: "atendente" as LocalRole,
  });

  const [editando, setEditando] = useState<ManagedUser | null>(null);
  const [excecoes, setExcecoes] = useState<Record<string, boolean>>({});
  const [papelEdit, setPapelEdit] = useState<LocalRole>("atendente");

  const [senhaAlvo, setSenhaAlvo] = useState<ManagedUser | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [excluirAlvo, setExcluirAlvo] = useState<ManagedUser | null>(null);

  const carregar = useCallback(async () => {
    if (!token || !isDesktop()) return;
    try {
      const [u, p, c] = await Promise.all([
        desktop.listUsers(token),
        desktop.listRoles(token),
        desktop.listPermissions(token),
      ]);
      setUsuarios(u);
      setPapeis(p);
      setCatalogo(c);
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível carregar");
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, LocalPermissionInfo[]>();
    for (const p of catalogo) {
      const lista = mapa.get(p.grupo) ?? [];
      lista.push(p);
      mapa.set(p.grupo, lista);
    }
    return [...mapa.entries()];
  }, [catalogo]);

  const papelDe = (chave: string) => papeis.find((p) => p.key === chave);

  /** O que a pessoa tem além do que o perfil concede. */
  const excecoesDoEditado = useMemo(
    // `permissions` do usuário já são as exceções: o perfil não entra nelas.
    () => editando?.permissions ?? [],
    [editando],
  );

  /**
   * Devolve a conta ao que o perfil diz.
   *
   * A sessão da pessoa cai junto: autorização em memória é foto do login.
   */
  const limparExcecoes = async () => {
    if (!token || !editando) return;
    setBusy(true);
    try {
      await desktop.clearUserExceptions(token, editando.id);
      toast.success(`${editando.full_name} passou a seguir só o perfil`);
      setEditando(null);
      await carregar();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível limpar");
    } finally {
      setBusy(false);
    }
  };

  if (!podeGerir) return null;

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

  const criar = async () => {
    if (!token) return;
    const ok = await executar(
      () =>
        desktop.createUser(token, {
          username: form.username.trim(),
          password: form.password,
          full_name: form.full_name.trim(),
          whatsapp: form.whatsapp || null,
          role: form.role,
        }),
      "Conta criada com senha provisória",
    );
    if (ok) {
      setNovoAberto(false);
      setForm({ username: "", full_name: "", whatsapp: "", password: "", role: "atendente" });
    }
  };

  const abrirEdicao = (u: ManagedUser) => {
    setEditando(u);
    setPapelEdit(u.role);
    const doPapel = new Set(papelDe(u.role)?.permissions ?? []);
    const marcadas: Record<string, boolean> = {};
    for (const p of catalogo) {
      // Marca o que o usuário tem hoje, venha do papel ou de exceção.
      marcadas[p.key] = u.permissions.includes(p.key) || doPapel.has(p.key);
    }
    setExcecoes(marcadas);
  };

  const salvarEdicao = async () => {
    if (!token || !editando) return;
    const doPapel = new Set(papelDe(papelEdit)?.permissions ?? []);
    // Só viaja o que é exceção: o que o papel já concede não vira permissão avulsa.
    const extras: Record<string, boolean> = {};
    for (const p of catalogo) {
      extras[p.key] = !!excecoes[p.key] && !doPapel.has(p.key);
    }
    const ok = await executar(
      () =>
        desktop.updateUser(token, {
          user_id: editando.id,
          full_name: editando.full_name,
          whatsapp: editando.whatsapp,
          role: papelEdit,
          permissions: extras,
        }),
      "Permissões atualizadas",
    );
    if (ok) setEditando(null);
  };

  const redefinirSenha = async () => {
    if (!token || !senhaAlvo) return;
    const ok = await executar(
      () => desktop.setUserPassword(token, senhaAlvo.id, novaSenha),
      "Senha redefinida",
    );
    if (ok) {
      setSenhaAlvo(null);
      setNovaSenha("");
    }
  };

  const excluir = async () => {
    if (!token || !excluirAlvo) return;
    const ok = await executar(() => desktop.deleteUser(token, excluirAlvo.id), "Conta excluída");
    if (ok) setExcluirAlvo(null);
  };

  const papelEditInfo = papelDe(papelEdit);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-4 pb-3 pt-4 sm:px-6">
        <div>
          <h1 className="text-3xl">Usuários</h1>
          <p className="num text-sm text-muted-foreground">
            {usuarios.length} conta(s) · criadas somente aqui, sem autocadastro
          </p>
        </div>
        <Button
          onClick={() => setNovoAberto(true)}
          variant="ghost"
          className="acao-receber h-12 rounded-sm px-5 font-bold uppercase"
          style={{ fontFamily: "var(--font-display)" }}
        >
          <UserPlus className="mr-2 h-4 w-4" aria-hidden /> Nova conta
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
        <div className="painel overflow-hidden">
          <ul>
            {usuarios.map((u) => {
              const papel = papelDe(u.role);
              // `u.permissions` traz só as exceções da pessoa. O que ela pode
              // de fato é o perfil somado a elas.
              const extras = u.permissions.length;
              const efetivas = new Set([...(papel?.permissions ?? []), ...u.permissions]).size;
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-[12rem] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{u.full_name}</span>
                      {u.is_permanent && (
                        <span
                          title="Conta permanente do sistema: não pode ser excluída nem rebaixada"
                          className="rotulo inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]"
                          style={{
                            color: "var(--success)",
                            background: "color-mix(in oklab, var(--success) 16%, transparent)",
                          }}
                        >
                          <Lock className="h-3 w-3" aria-hidden /> Permanente
                        </span>
                      )}
                      {u.must_change_password && (
                        <span
                          className="rotulo px-1.5 py-0.5 text-[10px]"
                          style={{
                            color: "var(--warning)",
                            background: "color-mix(in oklab, var(--warning) 18%, transparent)",
                          }}
                        >
                          Senha provisória
                        </span>
                      )}
                    </div>
                    <div className="num text-xs text-muted-foreground">{u.username}</div>
                  </div>

                  <div className="min-w-[8rem]">
                    <Rotulo>Papel</Rotulo>
                    <div className="text-sm font-medium">{papel?.name ?? u.role}</div>
                  </div>

                  <div className="min-w-[8rem]">
                    <Rotulo>Permissões</Rotulo>
                    <div className="num text-sm">
                      {papel?.is_master ? "todas" : `${efetivas}`}
                      {extras > 0 && (
                        <span
                          title="Permissões que esta pessoa tem além do perfil. Mudar o perfil não afeta estas."
                          className="rotulo ml-2 px-1.5 py-0.5 text-[10px]"
                          style={{
                            color: "var(--warning)",
                            background: "color-mix(in oklab, var(--warning) 18%, transparent)",
                          }}
                        >
                          +{extras} fora do perfil
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-[9rem]">
                    <Rotulo>Último acesso</Rotulo>
                    <div className="num text-sm text-muted-foreground">
                      {dataHora(u.last_login_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <BotaoAcao rotulo="Papel e permissões" onClick={() => abrirEdicao(u)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </BotaoAcao>
                    <BotaoAcao rotulo="Redefinir senha" onClick={() => setSenhaAlvo(u)}>
                      <KeyRound className="h-4 w-4" aria-hidden />
                    </BotaoAcao>
                    <BotaoAcao
                      rotulo={
                        u.is_permanent
                          ? "Conta permanente do sistema: não pode ser excluída"
                          : "Excluir conta"
                      }
                      disabled={u.is_permanent}
                      destrutivo
                      onClick={() => setExcluirAlvo(u)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </BotaoAcao>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Perfis de acesso: o padrão que cada conta herda. */}
        <section className="mt-6">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <Rotulo className="block">Perfis de acesso</Rotulo>
              <p className="mt-0.5 text-xs text-muted-foreground">
                O perfil é o padrão da conta. A exceção por pessoa continua valendo por cima dele.
              </p>
            </div>
            <Button
              onClick={() => setCriandoPerfil(true)}
              variant="outline"
              className="campo h-10 shrink-0 rounded-sm px-3 text-xs"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Novo perfil
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {papeis.map((p) => (
              <button
                key={p.key}
                type="button"
                // O master não abre: ele tem tudo por definição, e editá-lo
                // criaria um estado em que a loja fica sem quem administre.
                disabled={p.is_master}
                onClick={() => setPerfilEditando(p)}
                className={cn(
                  "placa p-4 text-left transition-colors",
                  p.is_master ? "cursor-default opacity-70" : "hover:border-foreground/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-base">{p.name}</h3>
                  {p.is_master ? (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                <p className="num mt-2 text-xs text-muted-foreground">
                  {p.is_master ? "Todas as permissões" : `${p.permissions.length} permissões`}
                  {` · ${p.user_count} conta(s)`}
                </p>
              </button>
            ))}
          </div>
        </section>

      </div>

      <DrawerPerfil
        papel={perfilEditando}
        criando={criandoPerfil}
        permissoes={catalogo}
        onFechar={() => {
          setPerfilEditando(null);
          setCriandoPerfil(false);
        }}
        onSalvo={carregar}
      />

      {/* Nova conta */}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Nova conta</DialogTitle>
            <DialogDescription>
              A conta nasce com senha provisória e obriga a pessoa a definir a própria senha no
              primeiro acesso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome completo</Label>
              <Input
                id="nome"
                autoFocus
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="h-12 rounded-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="usuario">Usuário</Label>
                <Input
                  id="usuario"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="sem espaços"
                  className="h-12 rounded-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="whats">WhatsApp (opcional)</Label>
                <Input
                  id="whats"
                  inputMode="numeric"
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value.replace(/\D/g, "") })}
                  className="num h-12 rounded-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <div className="flex flex-wrap gap-2">
                {papeis
                  // Master é a conta permanente do sistema, não um papel que
                  // se concede: o Rust recusa, e oferecer o que falha é armadilha.
                  .filter((p) => !p.is_master)
                  .map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setForm({ ...form, role: p.key as LocalRole })}
                      className={cn(
                        "rotulo h-11 border px-3 text-[12px] transition-colors",
                        form.role === p.key
                          ? "border-transparent bg-secondary text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov">Senha provisória</Label>
              <Input
                id="prov"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="h-12 rounded-sm"
              />
              <p className="text-xs text-muted-foreground">
                Mínimo de 8 caracteres. Entregue à pessoa; ela troca no primeiro acesso.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setNovoAberto(false)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy}
              onClick={criar}
              style={{ fontFamily: "var(--font-display)" }}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden /> Criar conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Papel e permissões */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">{editando?.full_name}</DialogTitle>
            <DialogDescription>
              O papel define o padrão. Marcar algo fora do papel cria uma exceção só para esta
              pessoa.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {/*
              Exceções são fáceis de criar e difíceis de perceber. Sem este
              aviso, tirar uma permissão do perfil e ver a pessoa continuar
              usando vira mistério — a permissão estava nela, não no perfil.
            */}
            {excecoesDoEditado.length > 0 && (
              <div
                className="flex flex-wrap items-start gap-3 border p-3"
                style={{
                  borderColor: "var(--warning)",
                  background: "color-mix(in oklab, var(--warning) 12%, transparent)",
                }}
              >
                <div className="min-w-[14rem] flex-1 text-sm leading-relaxed">
                  <strong>
                    {excecoesDoEditado.length} permissão(ões) fora do perfil {papelEditInfo?.name}
                  </strong>
                  <p className="mt-1 text-xs">
                    Mudar o perfil <strong>não afeta</strong> estas: elas pertencem a esta pessoa.
                  </p>
                  <p className="num mt-1 text-[11px] text-muted-foreground">
                    {excecoesDoEditado.join(" · ")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="campo h-11 shrink-0 rounded-sm px-3 text-xs"
                  disabled={busy}
                  onClick={limparExcecoes}
                >
                  Usar só o perfil
                </Button>
              </div>
            )}

            <div>
              <Rotulo className="mb-2 block">Papel</Rotulo>
              <div className="flex flex-wrap gap-2">
                {papeis.filter((p) => !p.is_master).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={editando?.is_permanent}
                    onClick={() => {
                      setPapelEdit(p.key as LocalRole);
                      const doPapel = new Set(p.permissions);
                      setExcecoes((atual) => {
                        const proximo = { ...atual };
                        for (const perm of catalogo) {
                          if (doPapel.has(perm.key)) proximo[perm.key] = true;
                        }
                        return proximo;
                      });
                    }}
                    className={cn(
                      "rotulo h-11 border px-3 text-[12px] transition-colors disabled:opacity-40",
                      papelEdit === p.key
                        ? "border-transparent bg-secondary text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {editando?.is_permanent && (
                <p className="mt-2 text-xs" style={{ color: "var(--warning)" }}>
                  Conta permanente do sistema: o papel não pode ser alterado.
                </p>
              )}
            </div>

            {papelEditInfo?.is_master ? (
              <div className="placa flex items-start gap-3 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  O papel Master carrega todas as permissões por definição, inclusive as que forem
                  criadas no futuro. Não há o que marcar aqui.
                </p>
              </div>
            ) : (
              grupos.map(([grupo, itens]) => (
                <div key={grupo}>
                  <Rotulo className="mb-2 block">{grupo}</Rotulo>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {itens.map((perm) => {
                      const doPapel = (papelEditInfo?.permissions ?? []).includes(perm.key);
                      const marcada = !!excecoes[perm.key];
                      return (
                        <label
                          key={perm.key}
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 border p-2.5 transition-colors",
                            marcada
                              ? "border-border bg-secondary"
                              : "border-border/60 hover:bg-accent",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={(e) =>
                              setExcecoes({ ...excecoes, [perm.key]: e.target.checked })
                            }
                            className="marcador mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{perm.rotulo}</span>
                            {perm.descricao && (
                              <span className="block text-xs text-muted-foreground">
                                {perm.descricao}
                              </span>
                            )}
                            <span className="rotulo mt-1 block text-[9px] text-muted-foreground">
                              {doPapel ? "do papel" : marcada ? "exceção" : "não concedida"}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy}
              onClick={salvarEdicao}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redefinir senha */}
      <Dialog open={!!senhaAlvo} onOpenChange={(o) => !o && setSenhaAlvo(null)}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Redefinir senha</DialogTitle>
            <DialogDescription>
              Nova senha para <strong>{senhaAlvo?.full_name}</strong>. Você define uma provisória e
              entrega à pessoa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nsenha">Nova senha</Label>
            <Input
              id="nsenha"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              className="h-12 rounded-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setSenhaAlvo(null)}>
              Cancelar
            </Button>
            <Button
              className="h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy || novaSenha.length < 8}
              onClick={redefinirSenha}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Redefinir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exclusão */}
      <Dialog open={!!excluirAlvo} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Excluir conta</DialogTitle>
            <DialogDescription>
              <strong>{excluirAlvo?.full_name}</strong> perde o acesso imediatamente. As vendas já
              registradas por esta pessoa continuam no histórico.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setExcluirAlvo(null)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-destrutiva h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy}
              onClick={excluir}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

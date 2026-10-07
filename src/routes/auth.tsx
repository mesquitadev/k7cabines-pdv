import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Lock, ShieldCheck, User } from "lucide-react";
import { desktop, isDesktop } from "@/lib/desktop";
import { Rotulo } from "@/components/placa";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — K7Cabines | PDV" },
      { name: "description", content: "Acesso ao ponto de venda." },
    ],
  }),
  component: AuthPage,
});

export default function AuthPage() {
  const { user, loading, acceptLocalSession } = useAuth();
  const navigate = useNavigate();

  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [nomeLoja, setNomeLoja] = useState("");
  const [cidade, setCidade] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [busy, setBusy] = useState(false);
  const [instalando, setInstalando] = useState<boolean | null>(null);

  // O assistente aparece sozinho enquanto a instalação não foi configurada.
  // Não existe atalho nem menu para chegar nele: ou a loja está configurada,
  // ou esta é a única tela possível.
  useEffect(() => {
    if (!isDesktop()) {
      setInstalando(false);
      return;
    }
    desktop
      .setupStatus()
      .then((s) => setInstalando(!s.setup_completed))
      .catch(() => setInstalando(false));
  }, []);

  if (loading || instalando === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Rotulo>Carregando</Rotulo>
      </div>
    );
  }
  if (user) return <Navigate to="/pdv" />;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDesktop()) return toast.error("Este aplicativo roda apenas no modo desktop.");
    setBusy(true);
    try {
      const sessao = await desktop.login({ username: usuario.trim(), password: senha });
      acceptLocalSession(sessao);
      navigate({ to: "/pdv" });
    } catch (erro) {
      // A mensagem é a mesma para conta inexistente e senha errada.
      toast.error(typeof erro === "string" ? erro : "Usuário ou senha inválidos");
      setSenha("");
    } finally {
      setBusy(false);
    }
  };

  const instalar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nomeLoja.trim().length < 2) return toast.error("Informe o nome da loja");
    if (senha.length < 8) return toast.error("A senha precisa de ao menos 8 caracteres");
    if (senha !== confirmacao) return toast.error("As senhas não conferem");
    setBusy(true);
    try {
      const sessao = await desktop.completeSetup({
        store_name: nomeLoja.trim(),
        store_city: cidade.trim(),
        master_password: senha,
      });
      acceptLocalSession(sessao);
      toast.success("Instalação concluída");
      navigate({ to: "/pdv" });
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível concluir a instalação");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1fr_28rem]">
      {/* Painel da marca: identifica o terminal antes de qualquer digitação. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex">
        <div className="trilho absolute inset-x-0 top-0 h-1.5" aria-hidden />
        <img
          src="/marca/k7-logo.png"
          alt="K7 Cabines Pavuna"
          className="h-24 w-auto object-contain"
        />
        <div className="max-w-md">
          <h1 className="text-4xl leading-tight">Ponto de venda</h1>
          <p className="mt-3 text-muted-foreground">
            Vendas, estoque com controle de validade, caixa e relatórios. Funciona sem internet,
            com os dados guardados neste computador.
          </p>
          <div className="mt-6 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            <Rotulo className="text-[11px]">Contas criadas apenas pelo master</Rotulo>
          </div>
        </div>
        <div className="trilho absolute inset-x-0 bottom-0 h-1.5" aria-hidden />
      </aside>

      {/* Terminal de acesso. */}
      <main className="flex flex-col justify-center px-6 py-10 sm:px-10">
        <img
          src="/marca/k7-logo.png"
          alt="K7 Cabines Pavuna"
          className="mb-8 h-16 w-auto self-start object-contain lg:hidden"
        />

        {instalando ? (
          <form onSubmit={instalar} className="w-full max-w-md space-y-5">
            <div>
              <Rotulo>Instalação</Rotulo>
              <h2 className="mt-1 text-3xl">Configurar esta loja</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Este computador vira um ponto de venda independente. Os dados ficam só aqui e
                não se comunicam com nenhuma outra loja.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loja">Nome da loja</Label>
              <Input
                id="loja"
                required
                autoFocus
                value={nomeLoja}
                onChange={(e) => setNomeLoja(e.target.value)}
                placeholder="Aparece no cabeçalho do cupom"
                className="h-12 rounded-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cidade">Cidade</Label>
              <Input
                id="cidade"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="Usada no cupom e no PIX"
                className="h-12 rounded-sm"
              />
            </div>

            <div className="placa space-y-3 p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
                <Rotulo className="text-[11px]">Conta master do sistema</Rotulo>
              </div>
              <p className="text-xs text-muted-foreground">
                Usuário <strong className="text-foreground">master</strong>. É a conta que cria
                todas as outras e não pode ser excluída. Defina a senha desta loja.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="senha">Senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-12 rounded-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmacao">Repetir senha</Label>
                  <Input
                    id="confirmacao"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    className="h-12 rounded-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Mínimo de 8 caracteres. Sem internet não há recuperação de senha: anote em local
                seguro antes de continuar.
              </p>
            </div>

            <Button
              type="submit"
              disabled={busy}
              className="acao-receber h-14 w-full rounded-sm text-lg font-bold uppercase"
              variant="ghost"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Configurando…" : "Concluir instalação"}
            </Button>
          </form>
        ) : (
          <form onSubmit={entrar} className="w-full max-w-sm space-y-5">
            <div>
              <Rotulo>Acesso ao terminal</Rotulo>
              <h2 className="mt-1 text-3xl">Entrar</h2>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="usuario">Usuário</Label>
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="usuario"
                  required
                  autoFocus
                  autoComplete="username"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  className="h-14 rounded-sm pl-10 text-lg"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="senha"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="h-14 rounded-sm pl-10 text-lg"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !usuario.trim() || !senha}
              variant="ghost"
              className="acao-receber h-14 w-full rounded-sm text-lg font-bold uppercase disabled:opacity-40"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Entrando…" : "Entrar"}
            </Button>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Esqueceu a senha? Peça a um usuário master para redefini-la em Usuários. Não existe
              autocadastro neste sistema.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}

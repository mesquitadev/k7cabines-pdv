import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import { desktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * Tela que a conta com senha provisória encontra ao entrar.
 *
 * A senha provisória passou por terceiro: foi digitada pelo gestor e entregue
 * no papel ou pelo WhatsApp. Enquanto ela valer, não se sabe quem está usando
 * a conta — e o registro de quem vendeu, quem deu desconto e quem fechou o
 * caixa perde o sentido.
 *
 * O bloqueio de verdade é no Rust, que recusa qualquer comando nesse estado.
 * Esta tela existe para a pessoa entender o motivo em vez de esbarrar em erro.
 */
export function TrocaDeSenhaObrigatoria() {
  const { session, profile, signOut, senhaTrocada } = useAuth();
  const token = session && "token" in session ? session.token : null;

  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const curta = nova.length > 0 && nova.length < 8;
  const diferente = confirmacao.length > 0 && nova !== confirmacao;
  const igualAAtual = nova.length > 0 && nova === atual;
  const pronto =
    atual.length > 0 && nova.length >= 8 && nova === confirmacao && !igualAAtual;

  const salvar = async () => {
    if (!token || !pronto) return;
    setSalvando(true);
    try {
      await desktop.changeOwnPassword(token, {
        current_password: atual,
        new_password: nova,
      });
      toast.success("Senha definida. Bom trabalho.");
      senhaTrocada();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível trocar a senha");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div
          className="mb-4 flex items-start gap-3 border p-4"
          style={{
            borderColor: "var(--warning)",
            background: "color-mix(in oklab, var(--warning) 12%, transparent)",
          }}
        >
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ color: "var(--warning)" }}
            aria-hidden
          />
          <div className="text-sm leading-relaxed">
            <strong className="block">Defina a sua senha para começar</strong>
            A senha que você recebeu foi criada por outra pessoa. Enquanto ela valer, o sistema
            não consegue provar que foi você quem vendeu — por isso a conta fica parada até aqui.
          </div>
        </div>

        <section className="placa p-5">
          <h1 className="flex items-center gap-2 text-2xl">
            <KeyRound className="h-5 w-5" aria-hidden /> Nova senha
          </h1>
          {profile?.full_name && (
            <p className="mt-1 text-sm text-muted-foreground">{profile.full_name}</p>
          )}

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="senhaAtual">Senha que você recebeu</Label>
              <Input
                id="senhaAtual"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                className="campo h-12 rounded-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senhaNova">Sua senha</Label>
              <Input
                id="senhaNova"
                type="password"
                autoComplete="new-password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                aria-invalid={curta || igualAAtual}
                className={cn(
                  "campo h-12 rounded-sm",
                  (curta || igualAAtual) && "border-destructive",
                )}
              />
              {igualAAtual ? (
                <p className="text-xs text-destructive">
                  A nova senha não pode ser a que você recebeu.
                </p>
              ) : (
                <p className={cn("text-xs", curta ? "text-destructive" : "text-muted-foreground")}>
                  Mínimo de 8 caracteres.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senhaConfirma">Repita a nova senha</Label>
              <Input
                id="senhaConfirma"
                type="password"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pronto) salvar();
                }}
                aria-invalid={diferente}
                className={cn("campo h-12 rounded-sm", diferente && "border-destructive")}
              />
              {diferente && (
                <p className="text-xs text-destructive">As duas senhas não são iguais.</p>
              )}
            </div>
          </div>

          <Button
            variant="ghost"
            className="acao-receber mt-5 h-12 w-full rounded-sm font-bold uppercase"
            disabled={salvando || !pronto}
            onClick={salvar}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Salvando…" : "Definir senha e entrar"}
          </Button>

          <p className="mt-4 text-xs text-muted-foreground">
            Sem internet não existe recuperação de senha. Anote em local seguro — nem o gestor
            consegue ver a sua senha, só definir uma nova provisória.
          </p>

          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 w-full text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Sair e entrar com outra conta
          </button>
        </section>
      </div>
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { sincronizarFonte } from "@/lib/fonte";
import { desktop, isDesktop, type LocalSession, type LocalUser } from "@/lib/desktop";

/**
 * Papel do usuário logado. Texto livre: os perfis são cadastrados na tela de
 * Usuários, então o conjunto não é conhecido em tempo de compilação. Quem
 * decide o que a pessoa pode é `pode()`, que olha a permissão — nunca o nome.
 */
export type AppRole = string;

interface Profile {
  id: string;
  full_name: string;
  whatsapp: string | null;
  access_pdv?: boolean;
  access_estoque?: boolean;
  access_relatorios?: boolean;
  access_usuarios?: boolean;
  access_impressora?: boolean;
  access_rel_vendas?: boolean;
  access_rel_hora?: boolean;
  access_rel_categorias?: boolean;
  access_rel_estoque?: boolean;
  access_rel_fechamento?: boolean;
  access_est_lotes?: boolean;
  access_est_novo?: boolean;
  access_est_add?: boolean;
  access_est_remove?: boolean;
  access_est_edit?: boolean;
  access_est_delete?: boolean;
}

interface AuthCtx {
  user: Pick<User, "id" | "email"> | null;
  /** Permissões efetivas do usuário, vindas do papel mais as exceções. */
  permissions: string[];
  /** Autorização se pergunta pela permissão, nunca pelo nome do papel. */
  pode: (permission: string) => boolean;
  session: Session | LocalSession | null;
  profile: Profile | null;
  /**
   * A conta ainda usa a senha provisória entregue pelo gestor.
   *
   * Enquanto for verdadeiro o Rust recusa qualquer operação: o bloqueio não é
   * de tela, é de servidor. A tela só evita que a pessoa esbarre em erro atrás
   * de erro sem entender o motivo.
   */
  precisaTrocarSenha: boolean;
  /** Chamado depois que a pessoa define a própria senha. */
  senhaTrocada: () => void;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  acceptLocalSession: (next: LocalSession) => void;
}

const Ctx = createContext<AuthCtx | null>(null);
const DESKTOP_SESSION_KEY = "k7:desktop-session-token";

function profileFromLocalUser(user: LocalUser): Profile {
  const has = (permission: string) => user.permissions.includes(permission);
  return {
    id: user.id,
    full_name: user.full_name,
    whatsapp: user.whatsapp,
    access_pdv: has("pdv.use"),
    access_estoque: has("stock.view"),
    access_relatorios: has("reports.view"),
    access_usuarios: has("users.manage"),
    access_impressora: has("printer.manage"),
    access_rel_vendas: has("reports.view"),
    access_rel_hora: has("reports.view"),
    access_rel_categorias: has("reports.view"),
    access_rel_estoque: has("reports.view"),
    access_rel_fechamento: has("reports.view"),
    access_est_lotes: has("stock.view"),
    access_est_novo: has("stock.create"),
    access_est_add: has("stock.add"),
    access_est_remove: has("stock.remove"),
    access_est_edit: has("stock.edit"),
    access_est_delete: has("stock.delete"),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | LocalSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [precisaTrocarSenha, setPrecisaTrocarSenha] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadExtras = async (uid: string) => {
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, whatsapp, access_pdv, access_estoque, access_relatorios, access_usuarios, access_impressora, access_rel_vendas, access_rel_hora, access_rel_categorias, access_rel_estoque, access_rel_fechamento, access_est_lotes, access_est_novo, access_est_add, access_est_remove, access_est_edit, access_est_delete").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((prof as Profile) ?? null);
    // Modo web legado: as permissões são derivadas das flags do perfil.
    const p = prof as Profile | null;
    setPermissions(
      p
        ? [
            p.access_pdv && "pdv.use",
            p.access_estoque && "stock.view",
            p.access_est_novo && "stock.create",
            p.access_est_edit && "stock.edit",
            p.access_est_add && "stock.add",
            p.access_est_remove && "stock.remove",
            p.access_est_delete && "stock.delete",
            p.access_est_lotes && "stock.batches",
            p.access_relatorios && "reports.view",
            p.access_usuarios && "users.manage",
            p.access_impressora && "printer.manage",
          ].filter((x): x is string => typeof x === "string")
        : [],
    );
    const list = (roles ?? []).map((r: { role: AppRole }) => r.role);
    const priority: AppRole[] = ["gerente", "supervisor", "atendente"];
    setRole(priority.find((p) => list.includes(p)) ?? null);
  };

  const acceptLocalSession = (next: LocalSession) => {
    setPermissions(next.user.permissions);
    // localStorage sobrevive ao fechamento do aplicativo; a validade de fato
    // é controlada no Rust, que expira a sessão em 16 horas.
    localStorage.setItem(DESKTOP_SESSION_KEY, next.token);
    setSession(next);
    setProfile(profileFromLocalUser(next.user));
    setPrecisaTrocarSenha(next.user.must_change_password);
    // O tamanho da letra é parâmetro da instalação; corrige o palpite local.
    void sincronizarFonte();
    setRole(next.user.role);
  };

  useEffect(() => {
    if (isDesktop()) {
      const token = localStorage.getItem(DESKTOP_SESSION_KEY);
      if (!token) {
        setLoading(false);
        return;
      }
      desktop.currentSession(token)
        .then((localUser) => acceptLocalSession({ token, user: localUser }))
        .catch(() => localStorage.removeItem(DESKTOP_SESSION_KEY))
        .finally(() => setLoading(false));
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        setTimeout(() => loadExtras(sess.user.id), 0);
      } else {
        setProfile(null);
        setRole(null);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadExtras(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        permissions,
        pode: (permission: string) => permissions.includes(permission),
        user: session
          ? "token" in session
            ? { id: session.user.id, email: session.user.username }
            : session.user
          : null,
        session,
        profile,
        precisaTrocarSenha,
        senhaTrocada: () => setPrecisaTrocarSenha(false),
        role,
        loading,
        signOut: async () => {
          if (isDesktop()) {
            if (session && "token" in session) await desktop.logout(session.token);
            localStorage.removeItem(DESKTOP_SESSION_KEY);
            setSession(null);
            setProfile(null);
            setPrecisaTrocarSenha(false);
            setRole(null);
            return;
          }
          await supabase.auth.signOut();
        },
        refresh: async () => {
          if (!session) return;
          if ("token" in session) {
            const localUser = await desktop.currentSession(session.token);
            acceptLocalSession({ token: session.token, user: localUser });
            return;
          }
          await loadExtras(session.user.id);
        },
        acceptLocalSession,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fora do AuthProvider");
  return v;
}

export function can(role: AppRole | null, action:
  | "stock.view" | "stock.add" | "stock.edit" | "stock.delete"
  | "users.manage" | "reports.view"
): boolean {
  if (!role) return false;
  switch (action) {
    case "stock.view": return true;
    case "stock.add": return role === "gerente" || role === "supervisor";
    case "stock.edit": return role === "gerente" || role === "supervisor";
    case "stock.delete": return role === "gerente" || role === "supervisor";
    case "users.manage": return role === "gerente";
    case "reports.view": return true;
  }
}

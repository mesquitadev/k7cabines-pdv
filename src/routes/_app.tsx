import { createFileRoute, Link, Outlet, useLocation, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { TrocaDeSenhaObrigatoria } from "@/components/troca-de-senha-obrigatoria";
import { AssistenteInicial, assistenteAdiado } from "@/components/assistente-inicial";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Package, BarChart3, LogOut, Wallet, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExpiryAlert } from "@/components/expiry-alert";
import { PendingSalesSync } from "@/components/pending-sales-sync";
import { fetchTicketSettings } from "@/lib/ticket-settings";
import { desktop, isDesktop, type SetupStatus } from "@/lib/desktop";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

/**
 * Nome de exibição dos papéis de fábrica. Perfis cadastrados pelo usuário não
 * estão aqui: para esses, a própria chave já nasce do nome escolhido, então
 * capitalizá-la é mais honesto que mostrar "—".
 */
const ROLE_LABEL: Record<string, string> = {
  master: "Master",
  gerente: "Gerente",
  supervisor: "Supervisor",
  atendente: "Atendente",
};

const rotuloDoPapel = (chave: string) =>
  ROLE_LABEL[chave] ??
  chave
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

/**
 * Telas que já possuem comandos locais em Rust/SQLite.
 * As demais continuam dependendo do Supabase e ficam indisponíveis no desktop
 * até que a migração correspondente seja concluída.
 */
const DESKTOP_READY_ROUTES = new Set([
  "/pdv", "/caixa", "/produtos", "/relatorios", "/impressora", "/usuarios", "/configuracoes",
]);

function AppLayout() {
  const { user, loading, profile, role, signOut, precisaTrocarSenha } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const desktopMode = isDesktop();

  /*
   * Roteiro de configuração inicial: só o master vê, só enquanto não concluiu
   * (ou adiou nesta sessão). Instalações antigas já nascem concluídas.
   */
  const [instalacao, setInstalacao] = useState<SetupStatus | null>(null);
  const [assistenteFechado, setAssistenteFechado] = useState(false);
  useEffect(() => {
    if (!desktopMode || role !== "master") return;
    desktop.setupStatus().then(setInstalacao).catch(() => setInstalacao(null));
  }, [desktopMode, role]);

  /**
   * Barra recolhível. A escolha é do operador e fica guardada: numa tela de
   * balcão cada coluna a mais no catálogo vale mais que o rótulo do menu.
   */
  const CHAVE_BARRA = "k7:barra-recolhida";
  const [recolhida, setRecolhida] = useState(false);
  useEffect(() => {
    try { setRecolhida(localStorage.getItem(CHAVE_BARRA) === "1"); } catch { /* sem persistência */ }
  }, []);
  const alternarBarra = () => {
    setRecolhida((atual) => {
      const proximo = !atual;
      try { localStorage.setItem(CHAVE_BARRA, proximo ? "1" : "0"); } catch { /* sem persistência */ }
      return proximo;
    });
  };

  useEffect(() => {
    // No desktop as configurações vêm do SQLite local.
    if (user) { fetchTicketSettings().catch(() => {}); }
  }, [user, desktopMode]);

  if (loading) return <div className="flex min-h-screen items-center justify-center">…</div>;
  if (!user) return <Navigate to="/auth" />;
  /*
   * Senha provisória bloqueia tudo, antes de qualquer rota.
   *
   * Não é decisão de tela: o Rust recusa todos os comandos nesse estado. Aqui
   * a pessoa vê o motivo em vez de bater em erro atrás de erro.
   */
  if (precisaTrocarSenha) return <TrocaDeSenhaObrigatoria />;

  if (
    desktopMode &&
    role === "master" &&
    instalacao &&
    instalacao.setup_completed &&
    !instalacao.onboarding_completed &&
    !assistenteFechado &&
    !assistenteAdiado()
  ) {
    return (
      <AssistenteInicial
        nomeLoja={instalacao.store_name}
        onFechar={() => {
          setAssistenteFechado(true);
          desktop.setupStatus().then(setInstalacao).catch(() => {});
        }}
      />
    );
  }

  const isManager = role === "gerente" || role === "master";
  const acc = {
    pdv: profile?.access_pdv ?? true,
    estoque: profile?.access_estoque ?? false,
    relatorios: profile?.access_relatorios ?? false,
    impressora: (profile?.access_impressora ?? false) || isManager,
    usuarios: (profile?.access_usuarios ?? false) || isManager,
  };

  const nav = [
    {
      to: "/pdv",
      label: "Venda",
      ajuda: "Registrar vendas, receber e imprimir o cupom com o número de retirada.",
      icon: ShoppingCart,
      show: acc.pdv,
    },
    {
      to: "/produtos",
      label: "Estoque",
      ajuda: "Produtos, categorias, entrada e saída, lotes com validade e inventário.",
      icon: Package,
      show: acc.estoque,
    },
    {
      to: "/caixa",
      label: "Turno",
      ajuda: "Abrir o turno com fundo de troco, fazer sangria e conferir a gaveta no fechamento.",
      icon: Wallet,
      show: acc.pdv,
    },
    {
      to: "/relatorios",
      label: "Relatórios",
      ajuda: "Vendas do período, movimento por hora, categorias e fechamento.",
      icon: BarChart3,
      show: acc.relatorios,
    },
    {
      to: "/configuracoes",
      label: "Configurações",
      ajuda: "Loja, cupom, PIX, usuários, parâmetros do sistema e manual de uso.",
      icon: Settings,
      show: acc.usuarios,
    },
  ];

  const routeAccess: Record<string, boolean> = {
    "/pdv": acc.pdv, "/caixa": acc.pdv, "/produtos": acc.estoque, "/relatorios": acc.relatorios,
    "/impressora": acc.impressora, "/usuarios": acc.usuarios, "/configuracoes": acc.usuarios,
  };
  const isAvailable = (to: string) => !desktopMode || DESKTOP_READY_ROUTES.has(to);

  const currentKey = Object.keys(routeAccess).find((k) => location.pathname.startsWith(k));
  if (currentKey && !isAvailable(currentKey)) {
    return <Navigate to="/pdv" />;
  }
  if (currentKey && !routeAccess[currentKey]) {
    const first = nav.find((n) => n.show);
    if (first && !location.pathname.startsWith(first.to)) {
      return <Navigate to={first.to as "/pdv"} />;
    }
    if (!first) {
      return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Sem permissões de acesso. Contate o gerente.</div>;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Barra de estação: onde você está e para onde pode ir. */}
      {/*
        Barra fixa. Recolhe para trilho de ícones — por escolha do operador ou
        por falta de largura — e nunca some: a navegação some, a orientação não.
      */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
          recolhida ? "w-16" : "w-16 lg:w-56",
        )}
      >
        <div className="flex items-center justify-center border-b border-sidebar-border px-2 py-3 lg:py-4">
          <img
            src="/marca/k7-logo.png"
            alt="K7 Cabines Pavuna"
            className={cn("w-auto object-contain", recolhida ? "h-10" : "h-10 lg:h-14")}
          />
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {nav.filter((n) => n.show).map((n) => {
            const active = location.pathname.startsWith(n.to);
            const Icon = n.icon;

            if (!isAvailable(n.to)) {
              return (
                <div
                  key={n.to}
                  aria-disabled="true"
                  title="Disponível quando esta tela passar para o banco local"
                  className="flex cursor-not-allowed items-center justify-center gap-3 px-3 py-3 opacity-40 lg:justify-start"
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className={cn("rotulo flex-1 text-[13px]", recolhida ? "hidden" : "hidden lg:block")}>
                    {n.label}
                  </span>
                  <span className={cn("rotulo text-[9px]", recolhida ? "hidden" : "hidden lg:block")}>
                    em breve
                  </span>
                </div>
              );
            }

            return (
              <Tooltip key={n.to}>
                <TooltipTrigger asChild>
              <Link
                to={n.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-3 transition-colors",
                  recolhida ? "justify-center" : "justify-center lg:justify-start",
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                {/* A parada atual é marcada por barra, não só por cor. */}
                <span
                  aria-hidden
                  className={cn("absolute inset-y-0 left-0 w-1", active ? "bg-primary" : "bg-transparent")}
                />
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className={cn("rotulo text-[13px]", recolhida ? "hidden" : "hidden lg:block")}>
                  {n.label}
                </span>
              </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <span className="rotulo block text-[12px]">{n.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                    {n.ajuda}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Sincronização é conceito do modo web; no desktop o SQLite já é a fonte oficial. */}
        {!desktopMode && <PendingSalesSync />}

        {/* Recolher: só faz sentido onde a barra caberia expandida. */}
        <button
          onClick={alternarBarra}
          aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
          title={recolhida ? "Expandir menu" : "Recolher menu"}
          className="hidden items-center justify-center gap-2 border-t border-sidebar-border py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
        >
          {recolhida ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden />
              <span className="rotulo text-[11px]">Recolher</span>
            </>
          )}
        </button>

        <div className="border-t border-sidebar-border p-2 lg:p-3">
          <div className={cn("px-1 pb-2", recolhida ? "hidden" : "hidden lg:block")}>
            <div className="truncate text-sm font-semibold">{profile?.full_name || user.email}</div>
            <span className="rotulo text-[10px] text-muted-foreground">
              {role ? rotuloDoPapel(role) : "—"}
            </span>
          </div>
          <Button
            variant="ghost"
            title={`Sair — ${profile?.full_name ?? ""}`}
            className={cn(
              "h-11 w-full rounded-sm px-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              recolhida ? "justify-center" : "justify-center lg:justify-start",
            )}
            onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
          >
            <LogOut className={cn("h-4 w-4", !recolhida && "lg:mr-2")} aria-hidden />
            <span className={cn(recolhida ? "hidden" : "hidden lg:inline")}>Sair</span>
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <ExpiryAlert />
    </div>
  );
}

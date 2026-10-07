import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "../lib/auth-context";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProvedorConfirmacao } from "@/components/confirmacao";
import { setupPwa } from "../lib/pwa";
import { isDesktop } from "../lib/desktop";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="num text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Tela não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          O endereço não existe ou a tela foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-sm bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Esta tela não abriu
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Houve uma falha no aplicativo. Nada do que já foi salvo se perdeu: vendas, estoque e
          turno ficam gravados no banco desta máquina.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="acao-receber inline-flex h-11 items-center justify-center rounded-sm px-5 text-sm font-bold uppercase"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Tentar de novo
          </button>
          <a
            href="/"
            className="campo inline-flex h-11 items-center justify-center rounded-sm px-5 text-sm font-medium text-foreground"
          >
            Voltar ao início
          </a>
        </div>

        {/* O detalhe técnico fica recolhido: quem opera não precisa dele, mas
            sem ele não há como saber o que aconteceu num balcão sem internet. */}
        <details className="mt-8 text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Detalhe técnico
          </summary>
          <pre className="num mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-border p-3 text-[11px] text-muted-foreground">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </details>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#000000" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "K7 PDV" },
      { title: "K7 Pavuna - PDV" },
      { name: "description", content: "Lovable POS System: A point-of-sale application for managing inventory, processing payments, and generating sales reports." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "K7 Pavuna - PDV" },
      { property: "og:description", content: "Lovable POS System: A point-of-sale application for managing inventory, processing payments, and generating sales reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "K7 Pavuna - PDV" },
      { name: "twitter:description", content: "Lovable POS System: A point-of-sale application for managing inventory, processing payments, and generating sales reports." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/bf601b1f-1f7c-41f8-be8d-4fbca95c077d/id-preview-54d6905d--c544da8b-0dd2-4a1e-aa5a-5a8bef5e4561.lovable.app-1780962430577.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/bf601b1f-1f7c-41f8-be8d-4fbca95c077d/id-preview-54d6905d--c544da8b-0dd2-4a1e-aa5a-5a8bef5e4561.lovable.app-1780962430577.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // No desktop o app é montado dentro de <div id="root"> de um index.html que já
  // provê <html>/<head>/<body>. Renderizar o shell aqui aninharia um documento
  // dentro de uma div e faria o HeadContent tentar sincronizar um <head> inválido.
  if (isDesktop()) return <>{children}</>;

  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    if (!isDesktop()) setupPwa();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={250} skipDelayDuration={0}>
          <ProvedorConfirmacao>
          <Outlet />
          </ProvedorConfirmacao>
        </TooltipProvider>
        <Toaster richColors position="top-center" offset={80} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

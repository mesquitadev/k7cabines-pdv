import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "K7 CABINES" },
      { name: "description", content: "Sistema de PDV com controle de estoque, caixa e relatórios." },
    ],
  }),
  component: Index,
});

function Index() {
  const { loading, user } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando…</div>;
  return <Navigate to={user ? "/pdv" : "/auth"} />;
}

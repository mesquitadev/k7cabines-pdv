import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Usuários deixou de ser uma tela própria: gerir contas é parametrizar o
 * sistema, e tudo isso vive em Configurações. A rota permanece para não
 * quebrar quem tinha o caminho salvo.
 */
export const Route = createFileRoute("/_app/usuarios")({
  ssr: false,
  component: () => <Navigate to="/configuracoes" />,
});

import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = (options: { desktop?: boolean } = {}) => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Rotas limpas, sem "#". No app empacotado o protocolo de asset devolve o
    // index.html para qualquer caminho, então recarregar em /produtos funciona.
    ...(options.desktop ? {} : {}),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

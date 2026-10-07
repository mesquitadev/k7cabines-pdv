const offlineOnly = (): never => {
  throw new Error("Serviços remotos estão desabilitados no aplicativo desktop offline.");
};

/**
 * Barreira de build: qualquer fluxo legado que tente acessar Supabase no desktop
 * falha antes de abrir uma conexão de rede.
 */
export const supabase = new Proxy({}, {
  get: offlineOnly,
}) as never;

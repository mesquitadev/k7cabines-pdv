import { desktop, desktopToken, type LocalRole, type ManagedUser } from "@/lib/desktop";

/**
 * Adaptador desktop das funções de usuário.
 *
 * A tela `_app.usuarios.tsx` chama estas funções pelo contrato do TanStack Start
 * (`fn({ data })`). Aqui elas resolvem contra os comandos Tauri locais, de modo
 * que a tela funciona sem alteração e sem qualquer chamada remota.
 */

const ACCESS_MAP: Record<string, string> = {
  access_pdv: "pdv.use",
  access_estoque: "stock.view",
  access_relatorios: "reports.view",
  access_impressora: "printer.manage",
  access_usuarios: "users.manage",
  access_rel_vendas: "reports.sales",
  access_rel_hora: "reports.hourly",
  access_rel_categorias: "reports.categories",
  access_rel_estoque: "reports.stock",
  access_rel_fechamento: "reports.closing",
  access_est_lotes: "stock.batches",
  access_est_novo: "stock.create",
  access_est_add: "stock.add",
  access_est_remove: "stock.remove",
  access_est_edit: "stock.edit",
  access_est_delete: "stock.delete",
};

function token(): string {
  const value = desktopToken();
  if (!value) throw new Error("Sessão local expirada. Entre novamente.");
  return value;
}

/** Converte o usuário do Rust para o formato de linha que a tela espera. */
function toRow(user: ManagedUser) {
  const row: Record<string, unknown> = {
    id: user.id,
    full_name: user.full_name,
    whatsapp: user.whatsapp,
    email: user.username,
    role: user.role,
    last_sign_in_at: user.last_login_at,
    created_at: null,
  };
  for (const [key, permission] of Object.entries(ACCESS_MAP)) {
    row[key] = user.permissions.includes(permission);
  }
  return row;
}

export const listUsersFull = async () => {
  const users = await desktop.listUsers(token());
  return users.map(toRow);
};

export const hasAnyUser = async () => ({ hasAny: true });

/** Enumerar contas é justamente o que a tela de acesso deixou de fazer. */
export const listLoginUsers = async () => [];

export const bootstrapFirstUser = async () => {
  throw new Error("A conta master é criada no assistente de instalação.");
};

type CreatePayload = { data: { email: string; password: string; full_name: string; whatsapp?: string; role: string } };
export const createUser = async ({ data }: CreatePayload) => {
  const user = await desktop.createUser(token(), {
    username: data.email,
    password: data.password,
    full_name: data.full_name,
    whatsapp: data.whatsapp || null,
    role: data.role as LocalRole,
  });
  return toRow(user);
};

type UpdatePayload = { data: Record<string, unknown> & { user_id: string } };
export const updateUser = async ({ data }: UpdatePayload) => {
  const permissions: Record<string, boolean> = {};
  let temPermissoes = false;
  for (const key of Object.keys(ACCESS_MAP)) {
    if (key in data) {
      permissions[key] = Boolean(data[key]);
      temPermissoes = true;
    }
  }
  const user = await desktop.updateUser(token(), {
    user_id: data.user_id,
    full_name: typeof data.full_name === "string" ? data.full_name : null,
    whatsapp: typeof data.whatsapp === "string" ? data.whatsapp : null,
    role: (data.role as LocalRole | undefined) ?? null,
    permissions: temPermissoes ? permissions : null,
  });
  return toRow(user);
};

export const setUserPassword = async ({ data }: { data: { user_id: string; password: string } }) => {
  await desktop.setUserPassword(token(), data.user_id, data.password);
  return { ok: true };
};

export const deleteUser = async ({ data }: { data: { user_id: string } }) => {
  await desktop.deleteUser(token(), data.user_id);
  return { ok: true };
};

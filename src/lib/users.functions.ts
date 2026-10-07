import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";



const CreateInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(72),
  full_name: z.string().min(1).max(255),
  whatsapp: z.string().max(20).optional().default(""),
});

const UpdateInput = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().min(1).max(255),
  whatsapp: z.string().max(20).optional().default(""),
  access_pdv: z.boolean().optional(),
  access_estoque: z.boolean().optional(),
  access_relatorios: z.boolean().optional(),
  access_usuarios: z.boolean().optional(),
  access_impressora: z.boolean().optional(),
  access_rel_vendas: z.boolean().optional(),
  access_rel_hora: z.boolean().optional(),
  access_rel_categorias: z.boolean().optional(),
  access_rel_estoque: z.boolean().optional(),
  access_rel_fechamento: z.boolean().optional(),
  access_est_lotes: z.boolean().optional(),
  access_est_add: z.boolean().optional(),
  access_est_remove: z.boolean().optional(),
  access_est_edit: z.boolean().optional(),
  access_est_delete: z.boolean().optional(),
});

export const hasAnyUser = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("user_roles")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return { hasAny: (count ?? 0) > 0 };
});

export const listLoginUsers = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name")
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  const { data: list, error: e2 } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (e2) throw new Error(e2.message);
  const emailById = new Map(list.users.map((u) => [u.id, u.email ?? ""]));
  return (profiles ?? [])
    .map((p) => ({ id: p.id, full_name: p.full_name || "(sem nome)", email: emailById.get(p.id) ?? "" }))
    .filter((u) => u.email);
});

export const bootstrapFirstUser = createServerFn({ method: "POST" })
  .inputValidator((d) => CreateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true });
    if ((count ?? 0) > 0) throw new Error("Já existe um gerente. Solicite a criação ao gerente.");
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, whatsapp: data.whatsapp },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateInput.extend({
    role: z.enum(["gerente", "supervisor", "atendente"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isManager, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "gerente",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isManager) throw new Error("Apenas o gerente pode criar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, whatsapp: data.whatsapp },
    });
    if (error) throw new Error(error.message);

    // trigger handle_new_user assigned 'atendente' (since users already exist). Override if needed.
    if (data.role !== "atendente" && created.user) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
      const { error: insErr } = await supabaseAdmin.from("user_roles").insert({
        user_id: created.user.id,
        role: data.role,
      });
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isManager, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "gerente",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isManager) throw new Error("Apenas o gerente pode editar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const update: {
      full_name: string; whatsapp: string;
      access_pdv?: boolean; access_estoque?: boolean; access_relatorios?: boolean; access_usuarios?: boolean; access_impressora?: boolean;
      access_rel_vendas?: boolean; access_rel_hora?: boolean; access_rel_categorias?: boolean; access_rel_estoque?: boolean; access_rel_fechamento?: boolean;
      access_est_lotes?: boolean; access_est_add?: boolean; access_est_remove?: boolean; access_est_edit?: boolean; access_est_delete?: boolean;
    } = { full_name: data.full_name, whatsapp: data.whatsapp };
    for (const key of [
      "access_pdv", "access_estoque", "access_relatorios", "access_usuarios", "access_impressora",
      "access_rel_vendas", "access_rel_hora", "access_rel_categorias", "access_rel_estoque", "access_rel_fechamento",
      "access_est_lotes", "access_est_add", "access_est_remove", "access_est_edit", "access_est_delete",
    ] as const) {
      const v = (data as Record<string, unknown>)[key];
      if (v !== undefined) (update as Record<string, unknown>)[key] = v;
    }
    const { error } = await supabaseAdmin
      .from("profiles")
      .update(update)
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

async function assertManager(context: { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }; userId: string }) {
  const { data: isManager, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "gerente",
  });
  if (error) throw new Error(error.message);
  if (!isManager) throw new Error("Apenas o gerente pode ver estes dados.");
}

export const listUsersFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: roles, error: e2 } = await supabaseAdmin.from("user_roles").select("user_id, role");
    if (e2) throw new Error(e2.message);

    const { data: list, error: e3 } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (e3) throw new Error(e3.message);

    const roleById = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]));
    const authById = new Map(list.users.map((u) => [u.id, u]));

    return (profiles ?? []).map((p) => {
      const a = authById.get(p.id);
      return {
        ...p,
        role: roleById.get(p.id) ?? null,
        email: a?.email ?? "",
        created_at_auth: a?.created_at ?? null,
        last_sign_in_at: a?.last_sign_in_at ?? null,
        email_confirmed_at: a?.email_confirmed_at ?? null,
      };
    });
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), password: z.string().min(6).max(72) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) {
      const msg = /weak|easy to guess|pwned|leaked/i.test(error.message)
        ? "Senha muito fraca ou já vazada na internet. Use algo mais forte (ex.: letras, números e símbolos)."
        : error.message;
      return { ok: false as const, error: msg };
    }
    return { ok: true as const, error: null };

  });


export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    if (data.user_id === "60789baa-3e35-43fd-b0b9-8b2d21f2f903") {
      return { ok: false as const, error: "A conta principal de Gerência não pode ser excluída." };
    }
    if (data.user_id === context.userId) {
      return { ok: false as const, error: "Você não pode excluir a si mesmo." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      const msg = /foreign key|violates/i.test(error.message)
        ? "Este usuário possui vendas registradas e não pode ser excluído."
        : error.message;
      return { ok: false as const, error: msg };
    }
    return { ok: true as const, error: null };
  });

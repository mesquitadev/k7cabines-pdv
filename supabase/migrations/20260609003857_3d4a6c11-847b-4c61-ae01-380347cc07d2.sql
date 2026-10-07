ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_pdv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_estoque boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_relatorios boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_usuarios boolean NOT NULL DEFAULT false;

-- Backfill based on current role
UPDATE public.profiles p SET
  access_pdv = true,
  access_estoque = CASE WHEN ur.role IN ('gerente','supervisor') THEN true ELSE false END,
  access_relatorios = CASE WHEN ur.role IN ('gerente','supervisor') THEN true ELSE false END,
  access_usuarios = CASE WHEN ur.role = 'gerente' THEN true ELSE false END
FROM public.user_roles ur
WHERE ur.user_id = p.id;
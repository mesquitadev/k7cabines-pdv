ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_est_lotes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_est_add boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_est_remove boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_est_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_est_delete boolean NOT NULL DEFAULT false;

UPDATE public.profiles p
SET access_est_lotes = true,
    access_est_add = true,
    access_est_remove = true,
    access_est_edit = true,
    access_est_delete = true
WHERE public.has_role(p.id, 'gerente'::app_role);

UPDATE public.profiles p
SET access_est_lotes = true,
    access_est_add = true,
    access_est_edit = true
WHERE public.has_role(p.id, 'supervisor'::app_role);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_rel_vendas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_rel_categorias boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_rel_estoque boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_rel_fechamento boolean NOT NULL DEFAULT true;

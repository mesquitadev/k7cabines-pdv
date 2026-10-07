ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_est_novo boolean NOT NULL DEFAULT false;

UPDATE public.profiles p SET access_est_novo = true
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role IN ('gerente','supervisor'));

DROP POLICY IF EXISTS "products insert sup/ger" ON public.products;
CREATE POLICY "products insert sup/ger" ON public.products FOR INSERT TO authenticated
WITH CHECK ((has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role))
  AND (has_stock_access(auth.uid(), 'access_est_novo') OR has_stock_access(auth.uid(), 'access_est_add')));
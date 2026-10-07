DROP POLICY IF EXISTS "sales read by role" ON public.sales;
CREATE POLICY "sales read all authenticated" ON public.sales FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sale_items read via sale" ON public.sale_items;
CREATE POLICY "sale_items read all authenticated" ON public.sale_items FOR SELECT TO authenticated USING (true);
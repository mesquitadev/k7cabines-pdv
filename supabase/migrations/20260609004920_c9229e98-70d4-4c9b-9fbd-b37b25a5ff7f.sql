CREATE TABLE IF NOT EXISTS public.deleted_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number integer NOT NULL,
  sale_total numeric NOT NULL DEFAULT 0,
  sale_created_at timestamptz NOT NULL,
  operator_name text NOT NULL DEFAULT '',
  deleted_by uuid,
  deleted_by_name text NOT NULL DEFAULT '',
  deleted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.deleted_sales TO authenticated;
GRANT ALL ON public.deleted_sales TO service_role;

ALTER TABLE public.deleted_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view deleted sales"
  ON public.deleted_sales FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.delete_sale(_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it RECORD;
  v_sale public.sales;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.has_role(auth.uid(), 'gerente') THEN
    RAISE EXCEPTION 'Apenas gerentes podem excluir vendas';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  -- Devolver estoque
  FOR it IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET stock = stock + it.quantity, updated_at = now() WHERE id = it.product_id;
  END LOOP;

  -- Registrar exclusão
  INSERT INTO public.deleted_sales (sale_number, sale_total, sale_created_at, operator_name, deleted_by, deleted_by_name)
  VALUES (v_sale.sale_number, v_sale.total, v_sale.created_at, COALESCE(v_sale.operator_name,''), auth.uid(), COALESCE(v_name,''));

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.sales WHERE id = _sale_id;
END;
$function$;
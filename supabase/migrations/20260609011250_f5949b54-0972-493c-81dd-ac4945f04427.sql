
ALTER TABLE public.deleted_sales ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.delete_sale(_sale_id uuid, _reason text DEFAULT '')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it RECORD;
  v_sale public.sales;
  v_name TEXT;
  v_reason TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_reason := COALESCE(btrim(_reason), '');
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  FOR it IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET stock = stock + it.quantity, updated_at = now() WHERE id = it.product_id;
  END LOOP;

  INSERT INTO public.deleted_sales (sale_number, sale_total, sale_created_at, operator_name, deleted_by, deleted_by_name, reason)
  VALUES (v_sale.sale_number, v_sale.total, v_sale.created_at, COALESCE(v_sale.operator_name,''), auth.uid(), COALESCE(v_name,''), v_reason);

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.sales WHERE id = _sale_id;
END;
$function$;

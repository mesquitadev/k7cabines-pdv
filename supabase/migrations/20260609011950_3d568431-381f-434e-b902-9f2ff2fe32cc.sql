CREATE OR REPLACE FUNCTION public.delete_product(_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prod public.products;
  v_name TEXT;
  v_qty INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.has_role(auth.uid(),'supervisor') THEN
    RAISE EXCEPTION 'Sem permissão para excluir produto';
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  v_qty := COALESCE(v_prod.stock, 0)::INTEGER;

  -- Registra a exclusão como baixa (quantidade negativa do estoque atual)
  INSERT INTO public.stock_additions (product_id, product_code, product_name, category, quantity, operator_id, operator_name)
  VALUES (NULL, v_prod.code, v_prod.name, v_prod.category, -v_qty, auth.uid(), COALESCE(v_name,''));

  DELETE FROM public.products WHERE id = _product_id;
END;
$function$
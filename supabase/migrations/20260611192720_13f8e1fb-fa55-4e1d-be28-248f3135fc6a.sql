
CREATE OR REPLACE FUNCTION public.delete_expired_batch(_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.product_batches;
  v_prod public.products;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Sem permissão para excluir lote';
  END IF;

  SELECT * INTO v_batch FROM public.product_batches WHERE id = _batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_batch.expiry_date >= CURRENT_DATE THEN
    RAISE EXCEPTION 'Apenas lotes vencidos podem ser excluídos';
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = v_batch.product_id;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products
    SET stock = GREATEST(stock - v_batch.quantity, 0), updated_at = now()
    WHERE id = v_batch.product_id;

  INSERT INTO public.stock_additions (product_id, product_code, product_name, category, quantity, operator_id, operator_name)
  VALUES (v_prod.id, v_prod.code, v_prod.name, v_prod.category, -v_batch.quantity::int, auth.uid(), COALESCE(v_name,'') || ' (lote vencido ' || to_char(v_batch.expiry_date,'DD/MM/YYYY') || ')');

  DELETE FROM public.product_batches WHERE id = _batch_id;
END;
$$;

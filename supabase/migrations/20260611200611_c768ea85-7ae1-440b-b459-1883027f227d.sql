CREATE OR REPLACE FUNCTION public.finalize_sale(_items jsonb, _cash numeric, _card numeric, _change numeric)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales;
  v_total NUMERIC := 0;
  v_count INT := 0;
  v_operator_name TEXT;
  v_last BIGINT;
  v_next BIGINT;
  it JSONB;
  v_remaining NUMERIC;
  v_pid UUID;
  b RECORD;
  v_take NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT full_name INTO v_operator_name FROM public.profiles WHERE id = auth.uid();

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_total := v_total + (it->>'subtotal')::NUMERIC;
    v_count := v_count + (it->>'quantity')::NUMERIC;
  END LOOP;

  SELECT sale_number INTO v_last FROM public.sales ORDER BY created_at DESC LIMIT 1;
  IF v_last IS NULL THEN
    v_next := 0;
  ELSE
    v_next := (v_last + 1) % 1000;
  END IF;

  INSERT INTO public.sales (sale_number, operator_id, operator_name, total, cash_amount, card_amount, change_amount, items_count)
  VALUES (v_next, auth.uid(), COALESCE(v_operator_name,''), v_total, _cash, _card, _change, v_count)
  RETURNING * INTO v_sale;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.sale_items (sale_id, product_id, product_code, product_name, category, unit_price, quantity, subtotal)
    VALUES (
      v_sale.id,
      NULLIF(it->>'product_id','')::UUID,
      it->>'product_code',
      it->>'product_name',
      COALESCE(it->>'category','Geral'),
      (it->>'unit_price')::NUMERIC,
      (it->>'quantity')::NUMERIC,
      (it->>'subtotal')::NUMERIC
    );

    IF NULLIF(it->>'product_id','') IS NOT NULL THEN
      v_pid := (it->>'product_id')::UUID;
      v_remaining := (it->>'quantity')::NUMERIC;

      UPDATE public.products
        SET stock = stock - v_remaining,
            updated_at = now()
        WHERE id = v_pid;

      -- Decrementa lotes FEFO (mais próximos do vencimento primeiro)
      FOR b IN
        SELECT id, quantity FROM public.product_batches
        WHERE product_id = v_pid AND quantity > 0
        ORDER BY expiry_date ASC, created_at ASC
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(b.quantity, v_remaining);
        UPDATE public.product_batches SET quantity = quantity - v_take WHERE id = b.id;
        v_remaining := v_remaining - v_take;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_sale;
END;
$function$;
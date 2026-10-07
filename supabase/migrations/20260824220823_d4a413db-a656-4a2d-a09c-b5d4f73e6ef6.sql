CREATE OR REPLACE FUNCTION public.has_stock_access(_user_id uuid, _flag text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  EXECUTE format('SELECT COALESCE(%I, false) FROM public.profiles WHERE id = $1', _flag)
    INTO v_ok USING _user_id;
  RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.has_stock_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_stock_access(uuid, text) TO authenticated, service_role;

-- add_stock: exige autorização "adicionar"
CREATE OR REPLACE FUNCTION public.add_stock(_product_id uuid, _quantity integer, _expiry_date date DEFAULT NULL::date)
 RETURNS stock_additions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prod public.products;
  v_name TEXT;
  v_row public.stock_additions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Sem permissão para adicionar estoque';
  END IF;
  IF NOT public.has_stock_access(auth.uid(), 'access_est_add') THEN
    RAISE EXCEPTION 'Sem permissão para adicionar estoque';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products SET stock = stock + _quantity, updated_at = now() WHERE id = _product_id;

  IF _expiry_date IS NOT NULL THEN
    INSERT INTO public.product_batches (product_id, expiry_date, quantity)
    VALUES (_product_id, _expiry_date, _quantity);
  END IF;

  INSERT INTO public.stock_additions (product_id, product_code, product_name, category, quantity, operator_id, operator_name)
  VALUES (v_prod.id, v_prod.code, v_prod.name, v_prod.category, _quantity, auth.uid(), COALESCE(v_name,''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- remove_stock: exige autorização "remover"
CREATE OR REPLACE FUNCTION public.remove_stock(_product_id uuid, _quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _current_stock integer;
  _user_id uuid;
  _user_name text;
  _product_name text;
  _product_code text;
  _category text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  IF NOT (public.has_role(_user_id,'gerente') OR public.has_role(_user_id,'supervisor')) THEN
    RAISE EXCEPTION 'Sem permissão para remover estoque';
  END IF;
  IF NOT public.has_stock_access(_user_id, 'access_est_remove') THEN
    RAISE EXCEPTION 'Sem permissão para remover estoque';
  END IF;

  SELECT full_name INTO _user_name FROM public.profiles WHERE id = _user_id;
  IF _user_name IS NULL OR _user_name = '' THEN
    _user_name := 'Usuário';
  END IF;

  SELECT stock, name, code, category INTO _current_stock, _product_name, _product_code, _category
  FROM public.products WHERE id = _product_id;

  IF _current_stock IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero';
  END IF;

  IF _current_stock - _quantity < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente para remover essa quantidade';
  END IF;

  UPDATE public.products SET stock = stock - _quantity, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.stock_additions (product_id, quantity, operator_id, operator_name, category, product_code, product_name)
  VALUES (_product_id, -_quantity, _user_id, _user_name, _category, _product_code, _product_name);
END;
$function$;

-- delete_product: exige autorização "excluir"
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
  IF NOT (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Sem permissão para excluir produto';
  END IF;
  IF NOT public.has_stock_access(auth.uid(), 'access_est_delete') THEN
    RAISE EXCEPTION 'Sem permissão para excluir produto';
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  v_qty := COALESCE(v_prod.stock, 0)::INTEGER;

  INSERT INTO public.stock_additions (product_id, product_code, product_name, category, quantity, operator_id, operator_name)
  VALUES (NULL, v_prod.code, v_prod.name, v_prod.category, -v_qty, auth.uid(), COALESCE(v_name,''));

  DELETE FROM public.products WHERE id = _product_id;
END;
$function$;

-- delete_expired_batch: exige autorização "gerenciar lotes"
CREATE OR REPLACE FUNCTION public.delete_expired_batch(_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.product_batches;
  v_prod public.products;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Sem permissão para excluir lote';
  END IF;
  IF NOT public.has_stock_access(auth.uid(), 'access_est_lotes') THEN
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
$function$;

-- RLS: produtos
DROP POLICY IF EXISTS "products insert sup/ger" ON public.products;
CREATE POLICY "products insert sup/ger" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor'))
    AND public.has_stock_access(auth.uid(), 'access_est_add')
  );

DROP POLICY IF EXISTS "products update gerente" ON public.products;
CREATE POLICY "products update gerente" ON public.products
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor'))
    AND public.has_stock_access(auth.uid(), 'access_est_edit')
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor'))
    AND public.has_stock_access(auth.uid(), 'access_est_edit')
  );

DROP POLICY IF EXISTS "products delete gerente" ON public.products;
CREATE POLICY "products delete gerente" ON public.products
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'gerente')
    AND public.has_stock_access(auth.uid(), 'access_est_delete')
  );

-- RLS: lotes
DROP POLICY IF EXISTS "Gerente/Supervisor can insert batches" ON public.product_batches;
CREATE POLICY "Gerente/Supervisor can insert batches" ON public.product_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor'))
    AND public.has_stock_access(auth.uid(), 'access_est_lotes')
  );

DROP POLICY IF EXISTS "Gerente/Supervisor can update batches" ON public.product_batches;
CREATE POLICY "Gerente/Supervisor can update batches" ON public.product_batches
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor'))
    AND public.has_stock_access(auth.uid(), 'access_est_lotes')
  );

DROP POLICY IF EXISTS "Gerente can delete batches" ON public.product_batches;
CREATE POLICY "Gerente can delete batches" ON public.product_batches
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'gerente')
    AND public.has_stock_access(auth.uid(), 'access_est_lotes')
  );
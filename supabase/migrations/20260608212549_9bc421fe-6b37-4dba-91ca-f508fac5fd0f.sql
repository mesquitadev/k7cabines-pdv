
CREATE OR REPLACE FUNCTION public.remove_stock(
  _product_id uuid,
  _quantity integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_stock integer;
  _user_id uuid;
  _user_name text;
  _product_name text;
  _product_code text;
  _category text;
BEGIN
  -- Get current user info
  _user_id := auth.uid();
  SELECT raw_user_meta->>'name' INTO _user_name FROM auth.users WHERE id = _user_id;
  IF _user_name IS NULL OR _user_name = '' THEN
    _user_name := 'Usuário';
  END IF;

  -- Get product info
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

  -- Update product stock
  UPDATE public.products SET stock = stock - _quantity WHERE id = _product_id;

  -- Log the removal as negative quantity in stock_additions
  INSERT INTO public.stock_additions (product_id, quantity, operator_id, operator_name, category, product_code, product_name)
  VALUES (_product_id, -_quantity, _user_id, _user_name, _category, _product_code, _product_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_stock(uuid, integer) TO service_role;

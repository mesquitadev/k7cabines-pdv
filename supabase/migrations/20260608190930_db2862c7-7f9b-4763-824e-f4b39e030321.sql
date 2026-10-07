
CREATE TABLE public.stock_additions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Geral',
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  operator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operator_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_additions TO authenticated;
GRANT ALL ON public.stock_additions TO service_role;

ALTER TABLE public.stock_additions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view stock additions"
  ON public.stock_additions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Gerente e supervisor podem adicionar"
  ON public.stock_additions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = operator_id AND
    (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'))
  );

CREATE OR REPLACE FUNCTION public.add_stock(_product_id UUID, _quantity NUMERIC)
RETURNS public.stock_additions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod public.products;
  v_name TEXT;
  v_row public.stock_additions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'Sem permissão para adicionar estoque';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products SET stock = stock + _quantity, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.stock_additions (product_id, product_code, product_name, category, quantity, operator_id, operator_name)
  VALUES (v_prod.id, v_prod.code, v_prod.name, v_prod.category, _quantity, auth.uid(), COALESCE(v_name,''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

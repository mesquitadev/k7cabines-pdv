
-- ENUM de funções
CREATE TYPE public.app_role AS ENUM ('gerente', 'supervisor', 'atendente');

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  whatsapp TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER_ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role (security definer, sem recursão)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- get_user_role helper (papel principal)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role WHEN 'gerente' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END
  LIMIT 1
$$;

-- Policies profiles
CREATE POLICY "profile self read" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "profile self update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "profile self insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Policies user_roles
CREATE POLICY "roles read own or gerente" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "roles gerente manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (public.has_role(auth.uid(), 'gerente'));

-- Trigger ao criar usuário: cria profile + atribui papel
-- Primeiro usuário do sistema vira gerente, demais viram atendente por padrão
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INT;
  default_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, whatsapp)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'whatsapp'
  );

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    default_role := 'gerente';
  ELSE
    default_role := 'atendente';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, default_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PRODUCTS
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Geral',
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Todos autenticados podem ver
CREATE POLICY "products read all" ON public.products
  FOR SELECT TO authenticated USING (true);
-- Supervisor e gerente podem inserir
CREATE POLICY "products insert sup/ger" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'));
-- Apenas gerente atualiza
CREATE POLICY "products update gerente" ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'))
  WITH CHECK (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'));
-- Apenas gerente exclui
CREATE POLICY "products delete gerente" ON public.products
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'gerente'));

-- Sequence de número de venda
CREATE SEQUENCE public.sale_number_seq START 1;
GRANT USAGE, SELECT ON SEQUENCE public.sale_number_seq TO authenticated;

-- SALES
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number BIGINT NOT NULL UNIQUE DEFAULT nextval('public.sale_number_seq'),
  operator_id UUID NOT NULL REFERENCES auth.users(id),
  operator_name TEXT NOT NULL DEFAULT '',
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  change_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  items_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales read by role" ON public.sales
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
    OR operator_id = auth.uid()
  );
CREATE POLICY "sales insert own" ON public.sales
  FOR INSERT TO authenticated WITH CHECK (operator_id = auth.uid());
-- Sem UPDATE / DELETE para nenhum role: vendas finalizadas são imutáveis

-- SALE_ITEMS
CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Geral',
  unit_price NUMERIC(12,2) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL
);
GRANT SELECT, INSERT ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sale_items read via sale" ON public.sale_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (public.has_role(auth.uid(),'gerente')
        OR public.has_role(auth.uid(),'supervisor')
        OR s.operator_id = auth.uid())
  ));
CREATE POLICY "sale_items insert via own sale" ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id AND s.operator_id = auth.uid()
  ));

-- Função finalize_sale: cria venda + itens + baixa estoque atômicamente
CREATE OR REPLACE FUNCTION public.finalize_sale(
  _items JSONB,
  _cash NUMERIC,
  _card NUMERIC,
  _change NUMERIC
) RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_total NUMERIC := 0;
  v_count INT := 0;
  v_operator_name TEXT;
  it JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT full_name INTO v_operator_name FROM public.profiles WHERE id = auth.uid();

  -- soma total
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_total := v_total + (it->>'subtotal')::NUMERIC;
    v_count := v_count + (it->>'quantity')::NUMERIC;
  END LOOP;

  INSERT INTO public.sales (operator_id, operator_name, total, cash_amount, card_amount, change_amount, items_count)
  VALUES (auth.uid(), COALESCE(v_operator_name,''), v_total, _cash, _card, _change, v_count)
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

    -- baixa estoque
    IF NULLIF(it->>'product_id','') IS NOT NULL THEN
      UPDATE public.products
        SET stock = stock - (it->>'quantity')::NUMERIC,
            updated_at = now()
        WHERE id = (it->>'product_id')::UUID;
    END IF;
  END LOOP;

  RETURN v_sale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_sale(JSONB, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

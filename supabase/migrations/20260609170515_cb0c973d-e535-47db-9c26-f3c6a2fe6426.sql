
CREATE TABLE public.ticket_settings (
  id INT PRIMARY KEY DEFAULT 1,
  store_name TEXT NOT NULL DEFAULT '',
  fiscal_label TEXT NOT NULL DEFAULT 'CUPOM NÃO FISCAL',
  chapelaria_label TEXT NOT NULL DEFAULT 'CHAPELARIA Nº',
  operator_label TEXT NOT NULL DEFAULT 'Operador',
  footer_message TEXT NOT NULL DEFAULT '',
  show_chapelaria BOOLEAN NOT NULL DEFAULT true,
  show_datetime BOOLEAN NOT NULL DEFAULT true,
  show_operator BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT ticket_settings_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE ON public.ticket_settings TO authenticated;
GRANT ALL ON public.ticket_settings TO service_role;

ALTER TABLE public.ticket_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read ticket settings"
  ON public.ticket_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers/supervisors can insert ticket settings"
  ON public.ticket_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'));

CREATE POLICY "Managers/supervisors can update ticket settings"
  ON public.ticket_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'))
  WITH CHECK (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'supervisor'));

INSERT INTO public.ticket_settings (id, store_name, footer_message)
VALUES (1, 'Sex Shop K7 Cabines - Pavuna', 'Até a próxima!')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sales ALTER COLUMN operator_id DROP NOT NULL;
ALTER TABLE public.sales DROP CONSTRAINT sales_operator_id_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES auth.users(id) ON DELETE SET NULL;
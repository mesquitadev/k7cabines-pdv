REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.finalize_sale(jsonb, numeric, numeric, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_product(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_sale(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_sale(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.remove_stock(uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_stock(uuid, integer, date) FROM anon, public;
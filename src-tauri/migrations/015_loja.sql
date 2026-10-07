BEGIN IMMEDIATE;

-- ============================================================
-- Identificação da loja.
--
-- Entra em `ticket_settings` porque todo campo daqui existe para sair impresso
-- no cabeçalho do cupom — não é cadastro por cadastro.
--
-- Nada disto viaja no modelo de loja: `template.rs` lista coluna por coluna o
-- que exporta, e endereço e CNPJ são justamente o que muda de uma loja para a
-- outra. Levar junto colocaria o endereço da matriz no cupom da filial.
-- ============================================================
ALTER TABLE ticket_settings ADD COLUMN legal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN document TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN address_line TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN district TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_settings ADD COLUMN zip TEXT NOT NULL DEFAULT '';
-- Linha livre do rodapé: Instagram, site, telefone de delivery.
ALTER TABLE ticket_settings ADD COLUMN contact_line TEXT NOT NULL DEFAULT '';

PRAGMA user_version = 15;

COMMIT;

import { supabase } from "@/integrations/supabase/client";
import { desktop, desktopToken, isDesktop } from "@/lib/desktop";

export interface TicketSettings {
  store_name: string;
  fiscal_label: string;
  chapelaria_label: string;
  operator_label: string;
  footer_message: string;
  show_chapelaria: boolean;
  show_datetime: boolean;
  show_operator: boolean;
  pix_key: string;
  pix_merchant_name: string;
  pix_merchant_city: string;
  /* Identificação da loja. Tudo aqui existe para sair no cabeçalho do cupom. */
  legal_name: string;
  /** CNPJ ou CPF, guardado só com dígitos. */
  document: string;
  phone: string;
  address_line: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  /** Linha livre do rodapé: Instagram, site, telefone de delivery. */
  contact_line: string;
}

export const DEFAULT_TICKET_SETTINGS: TicketSettings = {
  store_name: "",
  fiscal_label: "CUPOM NÃO FISCAL",
  chapelaria_label: "CHAPELARIA Nº",
  operator_label: "Operador",
  footer_message: "Até a próxima!",
  show_chapelaria: true,
  show_datetime: true,
  show_operator: true,
  pix_key: "",
  pix_merchant_name: "",
  pix_merchant_city: "",
  legal_name: "",
  document: "",
  phone: "",
  address_line: "",
  district: "",
  city: "",
  state: "",
  zip: "",
  contact_line: "",
};

const KEY = "pdv:ticket-settings:v1";

export function loadTicketSettings(): TicketSettings {
  if (typeof window === "undefined") return DEFAULT_TICKET_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TICKET_SETTINGS;
    return { ...DEFAULT_TICKET_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TICKET_SETTINGS;
  }
}

function writeCache(s: TicketSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Busca as configurações compartilhadas no servidor e atualiza o cache local. */
export async function fetchTicketSettings(): Promise<TicketSettings> {
  if (isDesktop()) {
    const token = desktopToken();
    if (!token) return loadTicketSettings();
    try {
      const local = await desktop.getTicketSettings(token);
      const merged: TicketSettings = { ...DEFAULT_TICKET_SETTINGS, ...local };
      writeCache(merged);
      return merged;
    } catch {
      return loadTicketSettings();
    }
  }
  try {
    const { data, error } = await supabase
      .from("ticket_settings")
      .select("store_name,fiscal_label,chapelaria_label,operator_label,footer_message,show_chapelaria,show_datetime,show_operator")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return loadTicketSettings();
    const merged: TicketSettings = { ...DEFAULT_TICKET_SETTINGS, ...(data as Partial<TicketSettings>) };
    writeCache(merged);
    return merged;
  } catch {
    return loadTicketSettings();
  }
}

/** Salva as configurações no servidor (compartilhadas com todos os dispositivos). */
export async function saveTicketSettings(s: TicketSettings): Promise<void> {
  if (isDesktop()) {
    const token = desktopToken();
    if (!token) throw new Error("Sessão local expirada. Entre novamente.");
    await desktop.saveTicketSettings(token, {
      store_name: s.store_name,
      fiscal_label: s.fiscal_label,
      footer_message: s.footer_message,
      show_chapelaria: s.show_chapelaria,
      chapelaria_label: s.chapelaria_label,
      show_datetime: s.show_datetime,
      show_operator: s.show_operator,
      operator_label: s.operator_label,
      pix_key: s.pix_key ?? "",
      pix_merchant_name: s.pix_merchant_name ?? "",
      pix_merchant_city: s.pix_merchant_city ?? "",
      legal_name: s.legal_name ?? "",
      document: s.document ?? "",
      phone: s.phone ?? "",
      address_line: s.address_line ?? "",
      district: s.district ?? "",
      city: s.city ?? "",
      state: s.state ?? "",
      zip: s.zip ?? "",
      contact_line: s.contact_line ?? "",
    });
    writeCache(s);
    return;
  }
  throw new Error("Serviços remotos estão desabilitados no aplicativo desktop offline.");
}

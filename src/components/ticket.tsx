import { useEffect, useState } from "react";
import { DEFAULT_TICKET_SETTINGS, loadTicketSettings, type TicketSettings } from "@/lib/ticket-settings";

export interface TicketItem {
  product_code: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface TicketSale {
  sale_number: number;
  total: number;
  cash_amount: number;
  card_amount: number;
  /** Recebido em PIX. */
  pix_amount?: number;
  /** Desconto concedido no total. */
  discount_amount?: number;
  change_amount: number;
  operator_name: string;
  items: TicketItem[];
  created_at: string;
}

/** CNPJ/CPF pontuado, igual ao que o Rust imprime. */
const formatarDoc = (d: string) => {
  const n = d.replace(/\D/g, "");
  if (n.length === 14) return `CNPJ ${n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`;
  if (n.length === 11) return `CPF ${n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`;
  return d;
};

const fmt = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function Ticket({ sale, settings: settingsProp }: { sale: TicketSale; settings?: TicketSettings }) {
  const [settings, setSettings] = useState<TicketSettings>(() => settingsProp ?? loadTicketSettings());

  useEffect(() => {
    setSettings(settingsProp ?? loadTicketSettings());
  }, [settingsProp]);

  const d = new Date(sale.created_at);
  return (
    <div style={{ padding: 4, fontSize: 12, lineHeight: 1.3 }}>
      {settings.store_name && (
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700 }}>{settings.store_name}</div>
      )}
      {/* Cada linha só aparece se estiver preenchida: cadastro incompleto não
          pode virar linha em branco no papel. */}
      {[
        settings.legal_name,
        settings.document && formatarDoc(settings.document),
        settings.address_line,
        [settings.district, settings.city, settings.state].filter(Boolean).join(" - "),
        settings.phone,
      ]
        .filter(Boolean)
        .map((linha, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10 }}>
            {linha}
          </div>
        ))}
      <div style={{ marginBottom: 4 }} />
      {settings.fiscal_label && (
        <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, backgroundColor: "#000", color: "#fff", padding: "4px 0" }}>{settings.fiscal_label}</div>
      )}
      {settings.show_chapelaria && (
        <div style={{ textAlign: "center", marginTop: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 11 }}>{settings.chapelaria_label}</div>
          <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, letterSpacing: 2 }}>
            {String(sale.sale_number).padStart(5, "0")}
          </div>
        </div>
      )}
      {(settings.show_datetime || settings.show_operator) && (
        <div style={{ borderTop: "1px dashed #000", borderBottom: "1px dashed #000", padding: "4px 0" }}>
          {settings.show_datetime && <div>{fmtDate(d)}</div>}
          {settings.show_operator && <div>{settings.operator_label}: {sale.operator_name}</div>}
        </div>
      )}
      <div style={{ padding: "4px 0" }}>
        {sale.items.map((i, idx) => (
          <div key={idx} style={{ marginBottom: 4 }}>
            <div>{i.product_name}</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{i.quantity} x {fmt(i.unit_price)}</span>
              <span>{fmt(i.subtotal)}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px dashed #000", paddingTop: 4 }}>
        {/* O desconto aparece sempre que existir: é o número que o cliente
            confere primeiro, e omiti-lo faz o total parecer errado. */}
        {(sale.discount_amount ?? 0) > 0 && (
          <>
            <Row k="Subtotal" v={fmt(sale.total + (sale.discount_amount ?? 0))} />
            <Row k="Desconto" v={`- ${fmt(sale.discount_amount ?? 0)}`} />
          </>
        )}
        <Row k="TOTAL" v={fmt(sale.total)} big />
        {sale.cash_amount > 0 && <Row k="Dinheiro" v={fmt(sale.cash_amount)} />}
        {sale.card_amount > 0 && <Row k="Maquininha" v={fmt(sale.card_amount)} />}
        {/* Vendas antigas podem ter PIX; novas não registram mais. */}
        {(sale.pix_amount ?? 0) > 0 && <Row k="PIX" v={fmt(sale.pix_amount ?? 0)} />}
        {sale.change_amount > 0 && <Row k="Troco" v={fmt(sale.change_amount)} />}
      </div>
      {settings.footer_message && (
        <div style={{ textAlign: "center", marginTop: 8, fontSize: 11 }}>{settings.footer_message}</div>
      )}
      {settings.contact_line && (
        <div style={{ textAlign: "center", marginTop: 2, fontSize: 10 }}>{settings.contact_line}</div>
      )}
    </div>
  );
}

function Row({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: big ? 16 : 12, fontWeight: big ? 800 : 400 }}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}

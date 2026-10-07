import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoMoeda } from "@/components/campo-moeda";
import { imprimeCupomSozinho, imprimirCupom, imprimirFicha } from "@/lib/impressao";
import { DrawerFichas } from "@/components/drawer-fichas";
import { avisoDeTurnoAntigo } from "@/lib/turno";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, Clock3, Ticket as TicketIcon, Lock, Minus, Plus, Printer, Search, ShoppingCart, Trash2, Unlock, Wallet, X } from "lucide-react";
import { Ticket } from "@/components/ticket";
import { loadTicketSettings, type TicketSettings } from "@/lib/ticket-settings";
// `offline-sales` era a fila de vendas para reenviar ao Supabase. No desktop a
// venda já grava no SQLite local, então só sobra o cache do último cupom.
import { saveLastTicket, loadLastTicket } from "@/lib/offline-sales";
import { desktop, isDesktop, type CashSession, type CashSessionSummary } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Label } from "@/components/ui/label";
import { FaixaLinha, Numeros, Rotulo, SeloLinha, StatusValidade } from "@/components/placa";
import {
  ESTOQUE_BAIXO,
  corDaLinha,
  dinheiro,
  linhaDe,
  nomeDaLinha,
  prioridadeCategoria,
  validadeDe,
  type Validade,
} from "@/lib/placa";

export const Route = createFileRoute("/_app/pdv")({
  head: () => ({ meta: [{ title: "Caixa — PDV" }] }),
  component: PDV,
});

interface Product {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  expiry?: string | null;
  /** Nome da variação, quando o item é uma variação de outro produto. */
  variantName?: string;
  /** Quantas variações este produto agrupa. Maior que zero, não é vendável. */
  variantCount?: number;
  /** GTIN impresso na embalagem, quando o produto tem. */
  barcode?: string | null;
  /** Faz a tela piscar enquanto está no pedido (produto ou categoria). */
  highlight?: boolean;
}

interface CartItem {
  product_id: string;
  product_code: string;
  product_name: string;
  category: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  /** Pago agora, retirado depois. A mercadoria fica na geladeira. */
  credito?: boolean;
  /** Faz a tela piscar enquanto está no pedido. */
  highlight?: boolean;
}

interface CompletedSale {
  sale_number: number;
  total: number;
  /** Id da venda no banco, usado para reimprimir pelo Rust. */
  id?: string;
  cash_amount: number;
  card_amount: number;
  pix_amount?: number;
  discount_amount?: number;
  change_amount: number;
  operator_name: string;
  items: CartItem[];
  created_at: string;
}

const toCents = (value: number) => Math.round(value * 100);
const isPulseiraK7 = (name: string) => name.toLowerCase().includes("pulseira k7");

export default function PDV() {
  const { profile, session, pode } = useAuth();
  // No desktop o SQLite local é a fonte oficial; nunca a fila web nem o Supabase.
  const localToken = session && "token" in session ? session.token : null;
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  // Pagamento em centavos inteiros: é como o Rust recebe e como o operador
  // digita (800 é oito reais). Float no meio do caminho só cria arredondamento.
  const [cash, setCash] = useState(0);
  const [card, setCard] = useState(0);
  const [desconto, setDesconto] = useState(0);
  /* Pedido do cliente: desconto não pede senha, pede motivo — e o motivo sai no relatório. */
  const [motivoDesconto, setMotivoDesconto] = useState("");
  const [clienteDesconto, setClienteDesconto] = useState("");
  /* Nome pelo qual a ficha é encontrada depois. Sem cadastro: apelido de fila. */
  const [nomeFicha, setNomeFicha] = useState("");
  const [fichasAberto, setFichasAberto] = useState(false);
  const [fichasAbertas, setFichasAbertas] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState<CompletedSale | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const [ticketSettings, setTicketSettings] = useState<TicketSettings>(loadTicketSettings());
  /**
   * Identificador desta tentativa de venda.
   *
   * Nasce com o pedido e só é renovado depois que a venda fecha. Gerá-lo
   * dentro do `finalize` fazia cada nova tentativa parecer uma venda diferente
   * para o Rust: se a transação commitasse e a resposta se perdesse — tela
   * travada, queda de luz no retorno —, o segundo clique criava uma SEGUNDA
   * venda real, baixando o estoque de novo e sobrando dinheiro na gaveta.
   * A idempotência existe e é testada no Rust; ela só precisava do mesmo id.
   */
  const idDaVenda = useRef(crypto.randomUUID());

  const [pedidoAberto, setPedidoAberto] = useState(false);
  const [vencidoPendente, setVencidoPendente] = useState<{ produto: Product; quantidade: number } | null>(null);
  const [frequentes, setFrequentes] = useState<Record<string, number>>({});
  const [turno, setTurno] = useState<CashSession | null>(null);
  /* Turno esquecido aberto mistura os dias na conferência do fechamento. */
  const avisoTurno = avisoDeTurnoAntigo(turno);
  const [resumoTurno, setResumoTurno] = useState<CashSessionSummary | null>(null);
  const [abrirCaixa, setAbrirCaixa] = useState(false);
  const [fundo, setFundo] = useState(0);

  useEffect(() => {
    const saved = loadLastTicket<CompletedSale>();
    if (saved) setLastSale(saved);
  }, []);

  // O trilho de acesso rápido aprende com o balcão: o que mais sai fica à mão.
  const CHAVE_FREQ = "k7:frequentes:v1";
  useEffect(() => {
    try {
      const bruto = localStorage.getItem(CHAVE_FREQ);
      if (bruto) setFrequentes(JSON.parse(bruto));
    } catch { /* primeira execução */ }
  }, []);

  const registrarUso = useCallback((productId: string, quantidade: number) => {
    setFrequentes((atual) => {
      const proximo = { ...atual, [productId]: (atual[productId] ?? 0) + quantidade };
      try { localStorage.setItem(CHAVE_FREQ, JSON.stringify(proximo)); } catch { /* sem persistência */ }
      return proximo;
    });
  }, []);

  const loadProducts = useCallback(async () => {
    if (!localToken) return;
    const [local, lotes] = await Promise.all([
      desktop.listProducts(localToken),
      desktop.listBatches(localToken).catch(() => []),
    ]);
    // Validade exibida é a do lote que vence primeiro — o que sai na próxima venda.
    const proxima = new Map<string, string>();
    for (const lote of lotes) {
      const atual = proxima.get(lote.product_id);
      if (!atual || lote.expiry_date < atual) proxima.set(lote.product_id, lote.expiry_date);
    }
    setProducts(
      local.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        category: p.category,
        price: p.price_cents / 100,
        stock: p.stock_quantity,
        expiry: proxima.get(p.id) ?? null,
        variantName: p.variant_name,
        variantCount: p.variant_count,
        barcode: p.barcode,
        highlight: p.highlight_effective,
      })),
    );
  }, [localToken]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  /** Quantas fichas ainda têm mercadoria esperando na geladeira. */
  const contarFichas = useCallback(async () => {
    if (!localToken || !pode("credit.withdraw")) return;
    try {
      setFichasAbertas((await desktop.listCreditVouchers(localToken)).length);
    } catch {
      setFichasAbertas(0);
    }
  }, [localToken, pode]);

  useEffect(() => {
    contarFichas();
  }, [contarFichas]);

  /**
   * Estado do turno. A venda depende dele, então ele mora aqui: o operador não
   * deveria descobrir sozinho que existe outra tela para destravar o caixa.
   */
  const carregarTurno = useCallback(async () => {
    if (!isDesktop() || !localToken) return;
    try {
      const atual = await desktop.cashOpenSession(localToken);
      setTurno(atual);
      setResumoTurno(atual ? await desktop.cashSummary(localToken, atual.id) : null);
    } catch {
      setTurno(null);
    }
  }, [localToken]);

  useEffect(() => {
    carregarTurno();
  }, [carregarTurno]);

  const filtered = useMemo(() => {
    // Produto que agrupa variações não é vendido: quem vai ao carrinho é a variação.
    const vendaveis = products.filter((p) => !p.variantCount);
    const bruto = search.trim();
    const q = /^\d{1,3}$/.test(bruto) && parseInt(bruto, 10) > 1 ? "" : bruto.toLowerCase();
    const list = q
      ? vendaveis.filter(
          (p) =>
            p.code.toLowerCase().includes(q) ||
            (p.barcode ?? "").includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            (p.variantName ?? "").toLowerCase().includes(q),
        )
      : [...vendaveis];
    return list.sort((a, b) => {
      const pa = prioridadeCategoria(a.category);
      const pb = prioridadeCategoria(b.category);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }, [products, search]);

  const total = useMemo(() => cart.reduce((s, i) => s + i.subtotal, 0), [cart]);
  /** Soma dos itens, antes do desconto. */
  const brutoCents = useMemo(() => Math.round(total * 100), [total]);
  /**
   * O que o cliente paga. O desconto nunca deixa o total negativo: o Rust
   * recusaria, e é melhor a tela já não permitir.
   */
  const totalCents = useMemo(
    () => Math.max(brutoCents - desconto, 0),
    [brutoCents, desconto],
  );
  const totalComDesconto = totalCents / 100;
  const itensNoPedido = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  /** Só dígitos na busca significam multiplicador, não código a procurar. */
  const multiplicador = useMemo(() => {
    const t = search.trim();
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = parseInt(t, 10);
    return n > 1 && n <= 999 ? n : null;
  }, [search]);

  /**
   * Acesso rápido. Enquanto não há histórico, é ordem de balcão e o rótulo diz
   * isso; só vira "Mais vendidos" quando existe venda registrada para sustentar
   * a afirmação.
   */
  const { trilho, trilhoTemHistorico } = useMemo(() => {
    const comUso = products
      .filter((p) => p.stock > 0)
      .map((p) => ({ p, uso: frequentes[p.id] ?? 0 }));
    const houveUso = comUso.some((x) => x.uso > 0);
    const ordenado = houveUso
      ? comUso.filter((x) => x.uso > 0).sort((a, b) => b.uso - a.uso)
      : [...comUso].sort(
          (a, b) => prioridadeCategoria(a.p.category) - prioridadeCategoria(b.p.category),
        );
    return {
      trilho: ordenado.slice(0, 4).map((x) => x.p),
      trilhoTemHistorico: houveUso,
    };
  }, [products, frequentes]);

  /** O catálogo não repete o que já está no trilho: duas placas iguais custam tempo. */
  const catalogo = useMemo(() => {
    if (search) return filtered;
    const noTrilho = new Set(trilho.map((p) => p.id));
    return filtered.filter((p) => !noTrilho.has(p.id));
  }, [filtered, trilho, search]);

  const cancelarPedido = () => {
    if (!cart.length) return;
    // Pedido cancelado é outro pedido: o id não pode ser reaproveitado.
    idDaVenda.current = crypto.randomUUID();
    setCart([]);
    setPedidoAberto(false);
    buscaRef.current?.focus();
    toast.success("Pedido cancelado");
  };

  /**
   * Adiciona ao pedido. `quantidade` vem do multiplicador: digitar um número na
   * busca e tocar no produto lança tudo de uma vez — seis cervejas são um toque,
   * não seis.
   */
  const addToCart = useCallback(
    (p: Product, quantidade = 1) => {
      if (p.stock <= 0) return toast.error(`${p.name} está sem estoque`);
      const k7 = isPulseiraK7(p.name);
      if (k7 && quantidade > 1) {
        toast.error("Pulseira K7: apenas 1 por venda.");
        quantidade = 1;
      }
      let entrou = 0;
      setCart((c) => {
        if (c.some((x) => x.credito)) {
          toast.error("Ficha é um item só: um produto, uma unidade por venda");
          return c;
        }
        const i = c.findIndex((x) => x.product_id === p.id);
        if (i >= 0) {
          if (k7) {
            toast.error("Pulseira K7: apenas 1 por venda. Finalize esta venda para incluir outra.");
            return c;
          }
          const q = Math.min(c[i].quantity + quantidade, p.stock);
          if (q === c[i].quantity) {
            toast.error(`Estoque insuficiente. Disponível: ${p.stock}`);
            return c;
          }
          if (c[i].quantity + quantidade > p.stock) {
            toast.error(`Só havia ${p.stock} em estoque de ${p.name}`);
          }
          entrou = q - c[i].quantity;
          const next = [...c];
          next[i] = { ...next[i], quantity: q, subtotal: +(q * next[i].unit_price).toFixed(2) };
          return next;
        }
        const q = Math.min(quantidade, p.stock);
        if (q < quantidade) toast.error(`Só havia ${p.stock} em estoque de ${p.name}`);
        entrou = q;
        return [
          ...c,
          {
            product_id: p.id,
            product_code: p.code,
            product_name: p.name,
            category: p.category,
            unit_price: Number(p.price),
            quantity: q,
            subtotal: +(q * Number(p.price)).toFixed(2),
            highlight: p.highlight,
          },
        ];
      });
      if (entrou > 0) registrarUso(p.id, entrou);
    },
    [registrarUso],
  );

  /**
   * Porta de entrada do pedido. Um lote vencido nunca entra por toque: exige
   * confirmação explícita do operador. Controle de validade é a razão de o
   * sistema existir, não um enfeite na placa.
   */
  const pedirParaAdicionar = useCallback(
    (p: Product, quantidade: number) => {
      if (validadeDe(p.expiry).status === "vencido") {
        setVencidoPendente({ produto: p, quantidade });
        return;
      }
      addToCart(p, quantidade);
    },
    [addToCart],
  );

  const confirmarVencido = () => {
    if (!vencidoPendente) return;
    addToCart(vencidoPendente.produto, vencidoPendente.quantidade);
    setVencidoPendente(null);
    buscaRef.current?.focus();
  };

  const changeQty = (id: string, delta: number) => {
    setCart((c) =>
      c.flatMap((i) => {
        if (i.product_id !== id) return [i];
        if (delta > 0 && isPulseiraK7(i.product_name)) {
          toast.error("Pulseira K7: apenas 1 por venda.");
          return [i];
        }
        if (delta > 0 && i.credito) {
          toast.error("Ficha é um item só: um produto, uma unidade por venda");
          return [i];
        }
        const q = i.quantity + delta;
        if (q <= 0) return [];
        if (delta > 0) {
          const prod = products.find((p) => p.id === id);
          if (prod && q > prod.stock) {
            toast.error(`Estoque insuficiente. Disponível: ${prod.stock}`);
            return [i];
          }
        }
        return [{ ...i, quantity: q, subtotal: +(q * i.unit_price).toFixed(2) }];
      }),
    );
  };

  /**
   * Digitar a quantidade direto, para não bater doze vezes no "+".
   *
   * O teto é o estoque: o Rust recusaria de qualquer jeito, mas descobrir isso
   * só na hora de receber, com o cliente na frente, é tarde. Aqui o valor é
   * limitado na hora e o motivo aparece.
   */
  const definirQty = (id: string, bruto: string) => {
    const digitos = bruto.replace(/\D/g, "").slice(0, 4);
    // Campo vazio no meio da digitação não pode apagar o item da lista.
    if (digitos === "") return;
    const desejada = parseInt(digitos, 10);
    if (desejada <= 0) return;

    const produto = products.find((p) => p.id === id);
    const item = cart.find((i) => i.product_id === id);
    if (!item) return;

    if (isPulseiraK7(item.product_name) && desejada > 1) {
      toast.error("Pulseira K7: apenas 1 por venda.");
      return;
    }
    if (item.credito && desejada > 1) {
      toast.error("Ficha é um item só: um produto, uma unidade por venda");
      return;
    }
    let quantidade = desejada;
    if (produto && desejada > produto.stock) {
      quantidade = produto.stock;
      toast.error(`Só há ${produto.stock} em estoque de ${produto.name}.`);
    }
    setCart((c) =>
      c.map((i) =>
        i.product_id === id
          ? { ...i, quantity: quantidade, subtotal: +(quantidade * i.unit_price).toFixed(2) }
          : i,
      ),
    );
  };

  /**
   * O pedido tem pulseira?
   *
   * A pulseira é o item que libera a cabine. Quando ela entra no pedido a tela
   * acende, para o atendente perceber sem ler — é o único item do catálogo com
   * consequência física do lado de fora do balcão.
   */
  /**
   * Itens que fazem a tela piscar: os marcados para "piscar na venda" (no
   * produto ou na categoria) e, por garantia, qualquer coisa da linha pulseira.
   */
  const itensDestaque = useMemo(
    () => cart.filter((i) => i.highlight || linhaDe(i.category) === "pulseira"),
    [cart],
  );
  const quantasPulseiras = useMemo(
    () => itensDestaque.reduce((soma, i) => soma + i.quantity, 0),
    [itensDestaque],
  );
  const temPulseira = quantasPulseiras > 0;
  const soPulseiras = itensDestaque.every((i) => linhaDe(i.category) === "pulseira");
  const textoDestaque = soPulseiras
    ? quantasPulseiras === 1 ? "Pulseira" : "Pulseiras"
    : itensDestaque.map((i) => `${i.quantity}× ${i.product_name}`).join(" · ");

  /**
   * Alterna o item entre levar agora e deixar em ficha.
   *
   * Só faz sentido para o que o cliente vai buscando aos poucos — bebida, na
   * prática. A pulseira dá entrada na cabine e sai na hora, então não entra
   * em ficha.
   */
  const alternarCredito = (id: string) => {
    setCart((c) =>
      c.map((i) =>
        i.product_id === id ? { ...i, credito: !i.credito } : i,
      ),
    );
  };

  /** Itens que ficam para retirar depois. */
  const itensEmFicha = useMemo(() => cart.filter((i) => i.credito), [cart]);
  const fichaMarcada = itensEmFicha.length > 0;

  /**
   * Caixa "FICHA" ao lado do total: marca o pedido inteiro como ficha ao
   * portador. Uma ficha leva um produto só, então o pedido precisa ter uma
   * única linha — quem quer dois produtos faz dois pedidos.
   */
  const alternarFicha = (ligar: boolean) => {
    if (ligar && (cart.length > 1 || cart.some((i) => i.quantity > 1))) {
      toast.error("Ficha é um item só: um produto, uma unidade por venda");
      return;
    }
    setCart((c) => c.map((i) => ({ ...i, credito: ligar })));
  };

  /** Ficha marcada: o pedido tem que ser exatamente um produto, uma unidade. */
  const fichaInvalida = (c: CartItem[]) =>
    c.some((i) => i.credito) && (c.length > 1 || c.some((i) => i.quantity > 1));

  /** Saldo do produto, para a dica de limite no campo de quantidade. */
  const estoqueDe = (id: string) => products.find((p) => p.id === id)?.stock ?? null;

  const removeItem = (id: string) => setCart((c) => c.filter((i) => i.product_id !== id));

  const openPay = useCallback(() => {
    if (!cart.length) return toast.error("Nenhum item no pedido");
    if (fichaInvalida(cart)) {
      return toast.error("Ficha é um item só: um produto, uma unidade por venda");
    }
    setCash(0);
    setCard(0);
    setDesconto(0);
    setMotivoDesconto("");
    setClienteDesconto("");
    setNomeFicha("");
    setPayOpen(true);
  }, [cart.length, total]);

  /** Leitor de código de barras: digita e dá Enter. Resultado único entra direto. */
  const onBuscaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const termo = search.trim();
    // O EAN vem primeiro: o leitor manda o número da embalagem, e ele identifica
    // um produto só. Só depois o SKU, e por último o resultado único da busca.
    const porEan = termo && filtered.find((p) => p.barcode === termo.replace(/\D/g, ""));
    const porSku = filtered.find((p) => p.code.toLowerCase() === termo.toLowerCase());
    const alvo = porEan ?? porSku ?? (filtered.length === 1 ? filtered[0] : null);
    if (!alvo) {
      if (filtered.length === 0) {
        toast.error(
          /^\d{8,14}$/.test(termo)
            ? "Nenhum produto com esse código de barras. Cadastre o EAN no Estoque."
            : "Nenhum produto encontrado",
        );
      }
      return;
    }
    pedirParaAdicionar(alvo, multiplicador ?? 1);
    setSearch("");
  };

  // Atalhos do balcão. F2 recebe o pagamento, Esc limpa a busca.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        if (!payOpen) openPay();
        return;
      }
      if (e.key === "Escape" && !payOpen) {
        setSearch("");
        buscaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPay, payOpen]);

  const finalize = async () => {
    const c = cash / 100;
    const k = card / 100;
    const paid = c + k;
    const aPagar = totalComDesconto;
    if (paid + 0.001 < aPagar) return toast.error("Valor pago é menor que o total");
    const change = +(c > 0 ? Math.max(paid - aPagar, 0) : 0).toFixed(2);
    if (!localToken) return toast.error("Sessão local expirada. Entre novamente.");
    if (fichaInvalida(cart)) {
      return toast.error("Ficha é um item só: um produto, uma unidade por venda");
    }
    if (desconto > 0 && motivoDesconto.trim().length < 3) {
      return toast.error("Escreva o motivo do desconto: ele sai no relatório de fechamento");
    }
    setBusy(true);
    try {
        const sale = await desktop.finalizeSale(localToken, {
          client_sale_id: idDaVenda.current,
          items: cart.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            credit: !!i.credito,
          })),
          credit_customer: nomeFicha.trim() || null,
          cash_tendered_cents: cash,
          card_cents: card,
          discount_cents: desconto,
          discount_reason: motivoDesconto.trim(),
          customer_name: clienteDesconto.trim(),
        });
        const completed: CompletedSale = {
          id: sale.id,
          sale_number: sale.sale_number,
          total: sale.total_cents / 100,
          cash_amount: sale.cash_tendered_cents / 100,
          card_amount: sale.card_cents / 100,
          pix_amount: sale.pix_cents / 100,
          discount_amount: sale.discount_cents / 100,
          change_amount: sale.change_cents / 100,
          operator_name: sale.operator_name,
          created_at: sale.created_at,
          items: sale.items.map((i) => ({
            product_id: i.product_id,
            product_code: i.product_code,
            product_name: i.product_name,
            category: i.category,
            unit_price: i.unit_price_cents / 100,
            quantity: i.quantity,
            subtotal: i.subtotal_cents / 100,
          })),
        };
        setLastSale(completed);
        saveLastTicket(completed);
        // Só depois do sucesso a próxima venda ganha um id novo.
        idDaVenda.current = crypto.randomUUID();
        setPayOpen(false);
        setCart([]);
        await loadProducts();
        await carregarTurno();
        toast.success(`Pedido ${String(sale.sale_number).padStart(5, "0")} emitido`);
        if (await imprimeCupomSozinho()) {
          await imprimirCupom(sale.id);
        }
        // A ficha é outro papel: prova o que falta retirar, e é ela que o
        // cliente leva no bolso.
        await imprimirFicha(sale.id);
        await contarFichas();
        buscaRef.current?.focus();
    } catch (error) {
      toast.error(typeof error === "string" ? error : "Não foi possível finalizar a venda");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Quem digita o dinheiro recebido não deve precisar zerar a maquininha:
   * o restante do total é abatido nela sozinho. Sem isso o troco sai somado
   * em cima de uma maquininha já preenchida — dinheiro a menos na gaveta.
   */
  const onDinheiro = (centavos: number) => {
    setCash(centavos);
    setCard(Math.max(totalCents - centavos, 0));
  };

  const abrirTurno = async () => {
    if (!localToken) return;
    setBusy(true);
    try {
      await desktop.cashOpen(localToken, fundo);
      toast.success("Turno aberto");
      setAbrirCaixa(false);
      setFundo(0);
      await carregarTurno();
      buscaRef.current?.focus();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível abrir o caixa");
    } finally {
      setBusy(false);
    }
  };

  const pagoDialogo = (cash + card) / 100;
  const trocoDialogo = Math.max(pagoDialogo - totalComDesconto, 0);
  const faltaDialogo = Math.max(totalComDesconto - pagoDialogo, 0);
  const ultimoNumero = lastSale ? String(lastSale.sale_number).padStart(5, "0") : null;

  const colunaPedido = (
    <>
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <h2 className="text-lg">Pedido em curso</h2>
        {cart.length > 0 && (
          <button
            onClick={cancelarPedido}
            className="rotulo flex h-9 items-center gap-1.5 px-2 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Cancelar
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {cart.length === 0 ? (
          <p className="px-2 py-16 text-center text-sm text-muted-foreground">
            Toque num produto ou leia o código de barras para começar.
          </p>
        ) : (
          <ul className="space-y-2">
            {cart.map((i) => (
              <li
                key={i.product_id}
                className="placa overflow-hidden"
              >
                <FaixaLinha categoria={i.category} />
                <div className="flex items-start justify-between gap-2 p-3 pb-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold leading-tight">{i.product_name}</div>
                    <div className="num mt-0.5 text-xs text-muted-foreground">
                      {dinheiro(i.unit_price)} cada
                    </div>
                  </div>
                  {pode("credit.sell") && linhaDe(i.category) !== "pulseira" && (
                    <button
                      onClick={() => alternarCredito(i.product_id)}
                      title={
                        i.credito
                          ? "Cliente leva agora"
                          : "Cliente paga agora e retira depois"
                      }
                      aria-pressed={!!i.credito}
                      aria-label={`Deixar ${i.product_name} em ficha`}
                      className={cn(
                        "flex h-11 shrink-0 items-center gap-1.5 border px-2.5 text-[11px] transition-colors",
                        i.credito
                          ? "border-transparent text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                      style={
                        i.credito
                          ? {
                              background: "color-mix(in oklab, var(--ring) 24%, transparent)",
                              borderColor: "var(--ring)",
                            }
                          : undefined
                      }
                    >
                      <TicketIcon className="h-4 w-4" aria-hidden />
                      <span className="rotulo">{i.credito ? "em ficha" : "ficha"}</span>
                    </button>
                  )}
                  <button
                    onClick={() => removeItem(i.product_id)}
                    className="grid h-11 w-11 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-destructive"
                    aria-label={`Remover ${i.product_name} do pedido`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center">
                    <button
                      onClick={() => changeQty(i.product_id, -1)}
                      className="grid h-11 w-11 place-items-center border border-border bg-secondary transition-colors hover:bg-accent"
                      aria-label={`Diminuir quantidade de ${i.product_name}`}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={i.quantity}
                      onChange={(e) => definirQty(i.product_id, e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      aria-label={`Quantidade de ${i.product_name}`}
                      title={
                        estoqueDe(i.product_id) !== null
                          ? `Máximo ${estoqueDe(i.product_id)} em estoque`
                          : undefined
                      }
                      className="num h-11 w-14 border-y border-border bg-background text-center text-xl font-bold outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      onClick={() => changeQty(i.product_id, 1)}
                      className="grid h-11 w-11 place-items-center border border-border bg-secondary transition-colors hover:bg-accent"
                      aria-label={`Aumentar quantidade de ${i.product_name}`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <Numeros valor={dinheiro(i.subtotal)} className="text-lg font-bold" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-sidebar-border p-4">
        {/* FICHA ao portador: o cliente paga agora e retira depois com o papel. */}
        <label
          className={cn(
            "mb-3 flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 select-none",
            fichaMarcada ? "border-primary bg-primary/15" : "border-border",
            !cart.length && "cursor-not-allowed opacity-40",
          )}
        >
          <input
            type="checkbox"
            className="h-6 w-6 accent-[var(--primary)]"
            checked={fichaMarcada}
            disabled={!cart.length}
            onChange={(e) => alternarFicha(e.target.checked)}
          />
          <span
            className="text-xl font-bold uppercase tracking-wide"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Ficha
          </span>
          <span className="text-xs text-muted-foreground">retira depois · 1 item por ficha</span>
        </label>
        <div className="mb-3 flex items-end justify-between gap-3">
          <Rotulo className="pb-2">Total</Rotulo>
          <Numeros
            valor={dinheiro(total)}
            className="text-[2.75rem] font-bold leading-none tracking-tight"
          />
        </div>
        <Button
          variant="ghost"
          onClick={openPay}
          disabled={!cart.length || !turno}
          title={!turno ? "Abra o turno para receber" : undefined}
          className="acao-receber h-16 w-full rounded-sm text-xl font-bold uppercase tracking-wide disabled:opacity-40"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Receber
        </Button>
      </div>
    </>
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col", temPulseira && "sinal-pulseira")}>
      {/*
        Anúncio de pulseira: ocupa a largura da tela, em corpo grande e
        piscando. Não é enfeite — é o que o cliente confere do outro lado do
        balcão e o que fica registrado na câmera.
      */}
      {temPulseira && (
        <div
          className="anuncio-pulseira relative z-50 shrink-0"
          role="status"
          aria-live="polite"
        >
          {soPulseiras && <span className="num quantas">{quantasPulseiras}</span>}
          {textoDestaque}
        </div>
      )}
      {/*
        Faixa de embarque: a placa da estação. À esquerda o localizador de
        destino; à direita o número que o cliente reconhece na chapelaria,
        na escala que o nome promete.
      */}
      <header className="trilho flex shrink-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={buscaRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onBuscaKeyDown}
            placeholder="Leia o código de barras, ou digite nome, SKU ou categoria"
            aria-label="Buscar produto por código de barras, SKU, nome ou categoria"
            className="h-14 rounded-sm border-input bg-background pl-11 pr-28 text-lg font-medium"
          />
          {multiplicador && (
            <span
              className="rotulo absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-[13px]"
              style={{
                color: "var(--ring)",
                background: "color-mix(in oklab, var(--ring) 18%, transparent)",
              }}
            >
              ×{multiplicador} no próximo toque
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end sm:gap-6">
          <div className="hidden text-right xl:block">
            <Rotulo>Atalhos</Rotulo>
            <div className="rotulo mt-1 text-[11px] text-muted-foreground">
              Enter adiciona · F2 recebe · Esc limpa
            </div>
          </div>

          {/*
            Fichas em aberto. Fica com rótulo e com a contagem porque é uma
            pendência da loja, não um atalho: enquanto houver ficha aberta há
            mercadoria paga esperando na geladeira.
          */}
          {pode("credit.withdraw") && (
            <button
              onClick={() => setFichasAberto(true)}
              title="Fichas em aberto — entregar o que o cliente já pagou"
              className={cn(
                "flex h-14 shrink-0 items-center gap-2.5 border px-4 transition-colors",
                fichasAbertas > 0
                  ? "border-transparent text-foreground"
                  : "placa text-muted-foreground hover:brightness-110",
              )}
              style={
                fichasAbertas > 0
                  ? {
                      background: "color-mix(in oklab, var(--ring) 24%, transparent)",
                      borderColor: "var(--ring)",
                    }
                  : undefined
              }
            >
              <TicketIcon className="h-6 w-6 shrink-0" aria-hidden />
              <span className="text-left leading-tight">
                <span className="rotulo block text-[10px]">Fichas</span>
                <span className="num block text-lg font-bold">
                  {fichasAbertas > 0 ? fichasAbertas : "—"}
                </span>
              </span>
            </button>
          )}

          {/* Último número emitido: o elemento que a plataforma inteira lê. */}
          <div className="hidden items-center gap-3 sm:flex">
            <div className="text-right">
              <Rotulo>Último pedido</Rotulo>
              {ultimoNumero ? (
                <Numeros
                  valor={ultimoNumero}
                  className="block text-[2.25rem] font-bold leading-none tracking-[0.06em]"
                />
              ) : (
                <span className="block text-sm text-muted-foreground">
                  nenhum pedido ainda
                </span>
              )}
            </div>
            <button
              onClick={() => void imprimirCupom(lastSale?.id ?? null)}
              disabled={!lastSale}
              title={lastSale ? "Reimprimir o último cupom" : "Nenhuma venda emitida ainda"}
              className="placa grid h-14 w-14 shrink-0 place-items-center transition-colors enabled:hover:brightness-110 disabled:opacity-35"
              aria-label="Reimprimir o último cupom"
            >
              <Printer className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {/* Estado do turno: a venda depende dele, então ele fica à vista. */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-4 py-2"
        style={{
          background: turno
            ? "color-mix(in oklab, var(--success) 10%, transparent)"
            : "color-mix(in oklab, var(--destructive) 12%, transparent)",
        }}
      >
        {turno ? (
          <>
            <span className="flex items-center gap-2">
              <Unlock className="h-4 w-4 shrink-0" style={{ color: "var(--success)" }} aria-hidden />
              <Rotulo
                style={{ color: avisoTurno ? "var(--warning)" : "var(--success)" }}
                title={avisoTurno ?? undefined}
              >
                {avisoTurno ? "Turno de outro dia" : "Turno aberto"}
              </Rotulo>
            </span>
            <span className="flex items-baseline gap-2">
              <Rotulo>Na gaveta</Rotulo>
              <span className="num text-base font-bold">
                {dinheiro((resumoTurno?.esperado_cents ?? 0) / 100)}
              </span>
            </span>
            <span className="flex items-baseline gap-2">
              <Rotulo>Vendas no turno</Rotulo>
              <span className="num text-base font-bold">{resumoTurno?.sales_count ?? 0}</span>
            </span>
            <Link
              to="/caixa"
              className="rotulo ml-auto flex h-9 items-center gap-2 border border-border px-3 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Wallet className="h-3.5 w-3.5" aria-hidden /> Sangria e fechamento
            </Link>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" style={{ color: "var(--destructive)" }} aria-hidden />
              <Rotulo style={{ color: "var(--destructive)" }}>Turno fechado</Rotulo>
            </span>
            <span className="text-sm text-muted-foreground">
              Nenhuma venda pode ser registrada sem turno aberto.
            </span>
            <Button
              onClick={() => setAbrirCaixa(true)}
              variant="ghost"
              className="acao-receber ml-auto h-9 rounded-sm px-4 font-bold uppercase"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <Unlock className="mr-2 h-3.5 w-3.5" aria-hidden /> Abrir turno
            </Button>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Trilho de acesso rápido: placas-mestras do que mais sai. */}
          {trilho.length > 0 && !search && (
            <div className="trilho px-3 py-3 sm:px-4">
              <Rotulo className="mb-2 block">
                {trilhoTemHistorico ? "Mais vendidos" : "Acesso rápido"}
              </Rotulo>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {trilho.map((p) => (
                  <PlacaProduto
                    key={p.id}
                    produto={p}
                    mestra
                    onAdd={() => { pedirParaAdicionar(p, multiplicador ?? 1); setSearch(""); }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="p-3 sm:p-4">
            {catalogo.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <p className="font-display text-2xl uppercase text-muted-foreground">
                  Nenhum produto encontrado
                </p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {search
                    ? `Nada corresponde a “${search}”. Confira o código ou limpe a busca com Esc.`
                    : "Cadastre produtos em Estoque para começar a vender."}
                </p>
              </div>
            ) : (
              <>
                {!search && trilho.length > 0 && (
                  <Rotulo className="mb-2 block">Catálogo</Rotulo>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5">
                  {catalogo.map((p) => (
                    <PlacaProduto
                      key={p.id}
                      produto={p}
                      onAdd={() => { pedirParaAdicionar(p, multiplicador ?? 1); setSearch(""); }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Legenda de linhas: segue o catálogo e ensina o código de cor. */}
          <div className="trilho flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-3 sm:px-4">
            <Rotulo>Linhas</Rotulo>
            {(["pulseira", "bebida", "erotico"] as const).map((linha) => {
              const quantos = products.filter(
                (p) => linhaDe(p.category) === linha && p.stock > 0,
              ).length;
              return (
                <span key={linha} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3 w-6 shrink-0"
                    style={{ background: corDaLinha[linha] }}
                  />
                  <span className="rotulo text-[11px]">{nomeDaLinha[linha]}</span>
                  <span className="num text-[11px] text-muted-foreground">{quantos}</span>
                </span>
              );
            })}
            <span className="ml-auto flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" style={{ color: "var(--warning)" }} aria-hidden />
                <span className="rotulo text-[11px] text-muted-foreground">Vencendo</span>
              </span>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--destructive)" }} aria-hidden />
                <span className="rotulo text-[11px] text-muted-foreground">Vencido</span>
              </span>
            </span>
          </div>
          {/* O perfil de trilho continua até a base, em vez de deixar buraco. */}
          <div className="trilho min-h-8 flex-1" aria-hidden />
        </section>

        {/* Coluna do pedido: fixa em tela larga, gaveta em tela estreita. */}
        <aside className="hidden w-[24rem] shrink-0 flex-col border-l border-border bg-sidebar lg:flex xl:w-[26rem]">
          {colunaPedido}
        </aside>
      </div>

      {/* Barra de resumo do pedido: só existe onde a coluna não cabe. */}
      <div className="trilho flex shrink-0 items-center gap-3 px-3 py-2 lg:hidden">
        <button
          onClick={() => setPedidoAberto(true)}
          disabled={!cart.length}
          className="flex min-w-0 flex-1 items-center gap-3 disabled:opacity-50"
        >
          <span className="placa grid h-12 w-12 shrink-0 place-items-center">
            <ShoppingCart className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 text-left">
            <Rotulo>{itensNoPedido} item(ns)</Rotulo>
            <Numeros valor={dinheiro(total)} className="block text-xl font-bold leading-tight" />
          </span>
        </button>
        <button
          onClick={() => void imprimirCupom(lastSale?.id ?? null)}
          disabled={!lastSale}
          className="placa grid h-14 w-14 shrink-0 place-items-center disabled:opacity-35 sm:hidden"
          aria-label={lastSale ? `Reimprimir o pedido ${ultimoNumero}` : "Nenhuma venda emitida ainda"}
        >
          <Printer className="h-5 w-5" aria-hidden />
        </button>
        <Button
          variant="ghost"
          onClick={openPay}
          disabled={!cart.length}
          className="acao-receber h-14 shrink-0 rounded-sm px-6 text-lg font-bold uppercase"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Receber
        </Button>
      </div>

      <Dialog open={pedidoAberto} onOpenChange={setPedidoAberto}>
        <DialogContent className="flex h-[85vh] max-w-lg flex-col gap-0 rounded-sm p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Pedido em curso</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col bg-sidebar">{colunaPedido}</div>
        </DialogContent>
      </Dialog>

      {/* Abertura do turno, sem sair da tela de venda. */}
      <Dialog open={abrirCaixa} onOpenChange={setAbrirCaixa}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Abrir turno</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <CampoMoeda
              id="fundoPdv"
              rotulo="Fundo de troco"
              grande
              autoFocus
              centavos={fundo}
              onChange={setFundo}
            />
            <p className="text-xs text-muted-foreground">
              Dinheiro que já está na gaveta antes da primeira venda. É a base da conferência no
              fechamento.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-12 rounded-sm" onClick={() => setAbrirCaixa(false)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-12 flex-1 rounded-sm font-bold uppercase"
              disabled={busy}
              onClick={abrirTurno}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Abrindo…" : "Abrir e vender"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lote vencido: barreira explícita, nunca um toque distraído. */}
      <Dialog open={!!vencidoPendente} onOpenChange={(o) => !o && setVencidoPendente(null)}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-6 w-6 shrink-0" style={{ color: "var(--destructive)" }} aria-hidden />
              Lote vencido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              O lote mais próximo de <strong>{vencidoPendente?.produto.name}</strong> está vencido
              {vencidoPendente?.produto.expiry
                ? ` desde ${vencidoPendente.produto.expiry.split("-").reverse().join("/")}`
                : ""}
              . A baixa sai deste lote primeiro.
            </p>
            <p className="text-sm text-muted-foreground">
              Confira a mercadoria antes de vender. Se estiver imprópria, descarte o lote em Estoque.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="h-12 flex-1 rounded-sm"
              onClick={() => setVencidoPendente(null)}
            >
              Não vender
            </Button>
            <Button
              variant="ghost"
              className="acao-destrutiva h-12 flex-1 rounded-sm"
              onClick={confirmarVencido}
            >
              Vender mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DrawerFichas
        aberto={fichasAberto}
        onFechar={() => setFichasAberto(false)}
        onRetirou={async () => {
          await loadProducts();
          await contarFichas();
        }}
      />

      {/* Pagamento */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Receber</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="border-b border-border pb-3">
              {desconto > 0 && (
                <div className="mb-1 flex items-baseline justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="num line-through">{dinheiro(total)}</span>
                </div>
              )}
              <div className="flex items-end justify-between">
                <Rotulo>A pagar</Rotulo>
                <span className="num text-4xl font-bold leading-none">
                  {dinheiro(totalComDesconto)}
                </span>
              </div>
            </div>

            {/* PIX é cobrado na maquininha, então entra como maquininha. */}
            <div className="grid grid-cols-2 gap-3">
              <CampoMoeda id="pagDinheiro" rotulo="Dinheiro" centavos={cash} onChange={onDinheiro} />
              <CampoMoeda id="pagCartao" rotulo="Maquininha" centavos={card} onChange={setCard} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="h-12 rounded-sm"
                onClick={() => { setCash(totalCents); setCard(0); }}
              >
                Só dinheiro
              </Button>
              <Button
                variant="outline"
                className="h-12 rounded-sm"
                onClick={() => { setCash(0); setCard(totalCents); }}
              >
                Só maquininha
              </Button>
              <Button
                variant="outline"
                className="h-12 rounded-sm"
                onClick={() => { const m = Math.round(totalCents / 2); setCash(m); setCard(totalCents - m); }}
              >
                Meio a meio
              </Button>
            </div>

            {/*
              Ficha ao portador: identificada por código impresso. O nome é
              opcional, só ajuda a achar na lista.
            */}
            {itensEmFicha.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <Label htmlFor="nomeFicha">Nome na ficha (opcional)</Label>
                <Input
                  id="nomeFicha"
                  value={nomeFicha}
                  onChange={(e) => setNomeFicha(e.target.value)}
                  placeholder="Ficha ao portador: o código sai impresso"
                  className="campo h-12 rounded-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {itensEmFicha.reduce((s, i) => s + i.quantity, 0)} item(ns) ficam para retirar:{" "}
                  {itensEmFicha.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}.
                </p>
              </div>
            )}

            {/* Desconto: qualquer operador pode dar, mas precisa escrever o motivo.
                O Rust recusa desconto sem motivo, e o motivo sai no fechamento. */}
            {(
              <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
                <CampoMoeda
                  id="pagDesconto"
                  rotulo="Desconto no total"
                  centavos={desconto}
                  onChange={(c) => {
                    const limitado = Math.min(c, brutoCents);
                    setDesconto(limitado);
                    // Refaz o rateio: o que já estava digitado virava troco falso.
                    setCash(0);
                    setCard(0);
                                  }}
                  className="w-40"
                />
                {desconto > 0 && (
                  <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                    <Label htmlFor="pagClienteDesconto">Cliente</Label>
                    <Input
                      id="pagClienteDesconto"
                      value={clienteDesconto}
                      onChange={(e) => setClienteDesconto(e.target.value)}
                      placeholder="Quem recebeu o desconto"
                      maxLength={60}
                    />
                    <Label htmlFor="pagMotivoDesconto">Motivo do desconto (obrigatório)</Label>
                    <Input
                      id="pagMotivoDesconto"
                      value={motivoDesconto}
                      onChange={(e) => setMotivoDesconto(e.target.value)}
                      placeholder="Ex.: cliente fiel, promoção, lata amassada"
                      maxLength={120}
                    />
                    <p className="text-xs text-muted-foreground">
                      {((desconto / Math.max(brutoCents, 1)) * 100).toFixed(1)}% de desconto ·
                      o motivo sai no cupom e no relatório de fechamento.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* O troco é o número que não pode ter dúvida. */}
            <div
              className="flex items-center justify-between border p-4"
              style={{
                borderColor: faltaDialogo > 0 ? "var(--destructive)" : "var(--success)",
                background:
                  faltaDialogo > 0
                    ? "color-mix(in oklab, var(--destructive) 14%, transparent)"
                    : "color-mix(in oklab, var(--success) 14%, transparent)",
              }}
            >
              <Rotulo
                className="text-[13px]"
                style={{ color: faltaDialogo > 0 ? "var(--destructive)" : "var(--success)" }}
              >
                {faltaDialogo > 0 ? "Falta receber" : "Troco"}
              </Rotulo>
              <Numeros
                valor={dinheiro(faltaDialogo > 0 ? faltaDialogo : trocoDialogo)}
                className="text-4xl font-bold leading-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-14 rounded-sm px-6" onClick={() => setPayOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              onClick={finalize}
              disabled={busy || faltaDialogo > 0}
              className="acao-receber h-14 flex-1 rounded-sm text-lg font-bold uppercase"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Emitindo…" : "Confirmar e imprimir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lastSale && (
        <div ref={printRef} className="print-ticket hidden print:block">
          <Ticket sale={lastSale} settings={ticketSettings} />
        </div>
      )}
    </div>
  );
}

/**
 * Placa de produto. A placa-mestra do trilho é maior e emoldurada com rebites;
 * a do catálogo é compacta. A hierarquia é de tamanho e moldura, não de cor.
 */
function PlacaProduto({
  produto,
  onAdd,
  mestra = false,
}: {
  produto: Product;
  onAdd: () => void;
  mestra?: boolean;
}) {
  const validade: Validade = validadeDe(produto.expiry);
  const semEstoque = produto.stock <= 0;
  const poucoEstoque = !semEstoque && produto.stock <= ESTOQUE_BAIXO;

  return (
    <button
      onClick={onAdd}
      disabled={semEstoque}
      aria-label={`${produto.name}${produto.variantName ? ` ${produto.variantName}` : ""}, ${dinheiro(produto.price)}, estoque ${produto.stock} unidades`}
      className={cn(
        "placa placa-produto group flex flex-col overflow-hidden p-0 text-left transition-transform duration-100 enabled:hover:-translate-y-0.5 enabled:hover:brightness-110 enabled:active:translate-y-0 disabled:opacity-45",
        mestra ? "placa-mestra min-h-[10.5rem]" : "min-h-[8.5rem]",
      )}
    >
      <FaixaLinha categoria={produto.category} />

      <div className={cn("flex flex-1 flex-col gap-1.5", mestra ? "p-4 pt-5" : "p-2.5")}>
        <SeloLinha categoria={produto.category} className="self-start" />
        <div
          className={cn(
            "line-clamp-2 font-semibold leading-tight",
            mestra ? "text-lg" : "text-[13px]",
          )}
        >
          {produto.name}
          {produto.variantName && (
            <span className="block text-muted-foreground">{produto.variantName}</span>
          )}
        </div>
        <div
          className={cn(
            "num mt-auto whitespace-nowrap font-bold leading-none",
            // Escala fluida com piso e teto: em coluna estreita o preço encolhe
            // em vez de perder os centavos. Preço cortado é preço errado.
            mestra
              ? "text-[clamp(1.25rem,2.1vw,2rem)]"
              : "text-[clamp(1rem,1.35vw,1.35rem)]",
          )}
        >
          {dinheiro(produto.price)}
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-1.5 overflow-hidden border-t border-border px-2.5 py-1.5">
        <span
          className="rotulo num shrink-0 whitespace-nowrap text-[11px]"
          style={{
            color: semEstoque
              ? "var(--destructive)"
              : poucoEstoque
                ? "var(--warning)"
                : "var(--muted-foreground)",
          }}
        >
          {semEstoque ? "Sem estoque" : `${produto.stock} un`}
        </span>
        <StatusValidade validade={validade} compacto />
      </div>
    </button>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useMemo } from "react";
import { desktop, isDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { BotaoAcao } from "@/components/botao-acao";
import { GestaoCategorias } from "@/components/gestao-categorias";
import { PainelVariacoes } from "@/components/painel-variacoes";
import { DialogoMovimento, type TipoMovimento } from "@/components/dialogo-movimento";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { CampoCategoria } from "@/components/campo-categoria";
import { Selecao } from "@/components/selecao";
import { DrawerCategoria } from "@/components/drawer-categoria";
import { useConfirmacao } from "@/components/confirmacao";
import { GestaoFornecedores } from "@/components/gestao-fornecedores";
import { CampoGtin, CampoSku, CampoUnidade } from "@/components/campos-identificacao";
import { CampoMoeda } from "@/components/campo-moeda";
import { checarGtin, checarSku, sugerirSku } from "@/lib/identificacao";
import { desktopToken, type LocalCategory, type LocalSupplier } from "@/lib/desktop";
import { Rotulo, SeloLinha, StatusValidade } from "@/components/placa";
import { corDaLinha, linhaDe, nomeDaLinha, validadeDe, type Linha, type StatusValidade as StatusValidadeTipo } from "@/lib/placa";
import { useAuth, can } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, PackagePlus, Minus, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Layers, Search, ChevronLeft, ChevronRight, ClipboardCheck, TrendingDown, CornerDownRight, MoreVertical, Boxes, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/produtos")({
  head: () => ({ meta: [{ title: "Estoque — PDV" }] }),
  component: Produtos,
});

interface Product {
  id: string; code: string; name: string; category: string; subcategory?: string | null;
  price: number; stock: number; cost: number; barcode: string | null; minStock: number;
  categoryId?: string | null; parentId?: string | null; variantName?: string; variantCount?: number;
  unit?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  lastPurchaseAt?: string | null;
  lastPurchaseCents?: number | null;
  highlight?: boolean;
  highlightEffective?: boolean;
}
interface Batch { id: string; product_id: string; expiry_date: string; quantity: number; }

/** Cartão de leitura rápida no topo do estoque. */
function Indicador({
  rotulo,
  valor,
  nota,
  cor,
  icone,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  cor?: string;
  icone: React.ReactNode;
}) {
  return (
    <div className="placa flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <Rotulo className="block">{rotulo}</Rotulo>
        <div className="num mt-1 text-2xl font-bold tabular-nums" style={cor ? { color: cor } : undefined}>
          {valor}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>
      </div>
      <span className="shrink-0 text-muted-foreground" style={cor ? { color: cor } : undefined}>
        {icone}
      </span>
    </div>
  );
}

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const isEroticCategory = (cat: string) => {
  const n = normalize(cat);
  // Todas as categorias exigem controle de validade por lote, exceto Pulseira
  return !n.includes("pulseira");
};

// --- Validação de categorias duplicadas / muito parecidas ---
const catKey = (s: string) =>
  normalize(s).replace(/[^a-z0-9]/g, "").replace(/s$/, "");

const levenshtein = (a: string, b: string) => {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
};

/** Retorna a categoria existente igual ou muito parecida, se houver. */
const findSimilarCategory = (candidate: string, existing: string[]) => {
  const key = catKey(candidate);
  if (!key) return null;
  for (const c of existing) {
    const ck = catKey(c);
    if (!ck) continue;
    if (ck === key) return c;
    const dist = levenshtein(key, ck);
    const similarity = 1 - dist / Math.max(key.length, ck.length);
    if (similarity >= 0.82) return c;
    if (key.length >= 4 && ck.length >= 4 && (ck.includes(key) || key.includes(ck))) return c;
  }
  return null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const daysUntil = (iso: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  return Math.floor((d.getTime() - today.getTime()) / 86400000);
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export default function Produtos() {
  const { role, profile, session, pode } = useAuth();
  // No desktop o SQLite local é a fonte oficial; nenhuma chamada remota é feita.
  const localToken = session && "token" in session ? session.token : null;
  const centavos = (valor: number) => Math.round(valor * 100);
  const isGerente = role === "gerente" || role === "master";
  const confirmar = useConfirmacao();
  const isSupervisor = role === "supervisor";
  const allow = (flag: keyof NonNullable<typeof profile>, base: boolean) => {
    const v = profile?.[flag];
    return base && v !== false;
  };
  // A autorização vem da permissão efetiva, nunca do nome do papel: papel novo
  // (como o master) passaria a ser negado em tudo se dependesse de uma lista fixa.
  const canBatches = pode("stock.batches");
  const canAdd = pode("stock.add");
  const canNewProd = pode("stock.create");
  const canRemove = pode("stock.remove");
  const canEditProd = pode("stock.edit");
  const canDeleteProd = pode("stock.delete");
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ code: "", name: "", category: "Geral", subcategory: "", priceCents: 0, costCents: 0, barcode: "", minStock: "", stock: "", expiry: "", categoryId: "", parentId: "", variantName: "", unit: "UN", supplierId: "", highlight: false });
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [isNewSubcategory, setIsNewSubcategory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [sort, setSort] = useState<{ column: "code" | "name" | "category" | "price" | "expiry" | "stock" | null; direction: "asc" | "desc" }>({ column: null, direction: "asc" });

  /* Um alvo e um tipo, no lugar dos três estados que existiam quando
     Adicionar, Remover e Inventário eram diálogos separados. */
  const [movAlvo, setMovAlvo] = useState<Product | null>(null);
  const [movTipo, setMovTipo] = useState<TipoMovimento>("entrada");
  /* Cadastro rápido de categoria por cima do formulário de produto. */
  const [criarCategoriaEm, setCriarCategoriaEm] = useState<{ pai: string | null } | null>(null);

  /** Fornecedores ativos, para o campo do produto e o da entrada de estoque. */
  const carregarFornecedores = useCallback(async () => {
    const token = desktopToken();
    if (!token || !pode("suppliers.view")) return;
    try {
      setFornecedores((await desktop.listSuppliers(token)).filter((f) => f.active));
    } catch {
      setFornecedores([]);
    }
  }, [pode]);

  const [batchesOpen, setBatchesOpen] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [aba, setAba] = useState<"produtos" | "categorias" | "fornecedores">("produtos");
  const [fornecedores, setFornecedores] = useState<LocalSupplier[]>([]);
  const [categorias, setCategorias] = useState<LocalCategory[]>([]);
  const [filtroLinha, setFiltroLinha] = useState<"todas" | Linha>("todas");
  const [filtroValidade, setFiltroValidade] = useState<"todos" | StatusValidadeTipo>("todos");
  const [batchesTarget, setBatchesTarget] = useState<Product | null>(null);

  const load = async () => {
    {
      if (!localToken) return;
      const [prods, bats] = await Promise.all([
        desktop.listProducts(localToken),
        desktop.listBatches(localToken),
      ]);
      setProducts(prods.map((p) => ({
        id: p.id, code: p.code, name: p.name, category: p.category,
        subcategory: p.subcategory, price: p.price_cents / 100, stock: p.stock_quantity,
        cost: p.cost_cents / 100, barcode: p.barcode, minStock: p.min_stock,
        categoryId: p.category_id, parentId: p.parent_id, variantName: p.variant_name,
        variantCount: p.variant_count,
        unit: p.unit ?? "UN",
        supplierId: p.supplier_id,
        supplierName: p.supplier_name,
        lastPurchaseAt: p.last_purchase_at,
        lastPurchaseCents: p.last_purchase_cents,
        highlight: p.highlight,
        highlightEffective: p.highlight_effective,
      })));
      setBatches(bats);
      return;
    }
  };
  useEffect(() => { load(); }, [localToken]);

  const carregarCategorias = useCallback(async () => {
    if (!localToken) return;
    try { setCategorias(await desktop.listCategories(localToken)); } catch { setCategorias([]); }
  }, [localToken]);
  useEffect(() => { carregarCategorias(); }, [carregarCategorias]);
  useEffect(() => { carregarFornecedores(); }, [carregarFornecedores]);

  // Mapa: produto -> validade mais próxima (a partir de hoje; se nenhuma futura, a mais recente)
  const nearestExpiryByProduct = useMemo(() => {
    const map = new Map<string, string>();
    const today = todayISO();
    const grouped = new Map<string, Batch[]>();
    for (const b of batches) {
      const arr = grouped.get(b.product_id) ?? [];
      arr.push(b);
      grouped.set(b.product_id, arr);
    }
    for (const [pid, arr] of grouped) {
      const future = arr.filter(b => b.expiry_date >= today).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
      const chosen = future[0] ?? [...arr].sort((a, b) => b.expiry_date.localeCompare(a.expiry_date))[0];
      if (chosen) map.set(pid, chosen.expiry_date);
    }
    return map;
  }, [batches]);

  const batchesByProduct = useMemo(() => {
    const map = new Map<string, Batch[]>();
    for (const b of batches) {
      const arr = map.get(b.product_id) ?? [];
      arr.push(b);
      map.set(b.product_id, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    return map;
  }, [batches]);

  // Aviso global de validade próxima é exibido pelo componente <ExpiryAlert /> no layout.

  const handleSort = (column: "code" | "name" | "category" | "price" | "expiry" | "stock") => {
    setSort((prev) => {
      if (prev.column === column) return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      return { column, direction: "asc" };
    });
  };

  const POR_PAGINA = 12;
  const sortedProducts = useMemo(() => {
    if (!sort.column) return products;
    const col = sort.column;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...products].sort((a, b) => {
      let cmp = 0;
      if (col === "code") cmp = a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" });
      else if (col === "name") cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      else if (col === "category") cmp = a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
      else if (col === "price") cmp = (a.price ?? 0) - (b.price ?? 0);
      else if (col === "stock") cmp = (a.stock ?? 0) - (b.stock ?? 0);
      else if (col === "expiry") {
        const aExp = nearestExpiryByProduct.get(a.id) ?? "9999-12-31";
        const bExp = nearestExpiryByProduct.get(b.id) ?? "9999-12-31";
        cmp = aExp.localeCompare(bExp);
      }
      return cmp * dir;
    });
  }, [products, sort, nearestExpiryByProduct]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return sortedProducts;
    const q = normalize(searchQuery);
    return sortedProducts.filter((p) =>
      normalize(p.code).includes(q) ||
      (p.barcode ?? "").includes(q) ||
      normalize(p.name).includes(q) ||
      normalize(p.category).includes(q) ||
      normalize(p.subcategory ?? "").includes(q) ||
      String(p.price).includes(q)
    );
  }, [sortedProducts, searchQuery]);

  /** Filtros de balcão: por linha e por status de validade. */
  const porLinha = useMemo(() => {
    if (filtroLinha === "todas") return filteredProducts;
    return filteredProducts.filter((p) => linhaDe(p.category) === filtroLinha);
  }, [filteredProducts, filtroLinha]);

  const listaFinal = useMemo(() => {
    if (filtroValidade === "todos") return porLinha;
    return porLinha.filter(
      (p) => validadeDe(nearestExpiryByProduct.get(p.id)).status === filtroValidade,
    );
  }, [porLinha, filtroValidade, nearestExpiryByProduct]);

  /**
   * Ordena mantendo cada variação logo abaixo do seu produto. Sem isso, "Gel
   * 50 ml" e "Gel 100 ml" apareceriam em páginas diferentes por ordem alfabética.
   */
  const listaAgrupada = useMemo(() => {
    const porId = new Map(listaFinal.map((p) => [p.id, p]));
    const out: Product[] = [];
    const visto = new Set<string>();
    for (const p of listaFinal) {
      if (p.parentId && porId.has(p.parentId)) continue;
      if (visto.has(p.id)) continue;
      out.push(p);
      visto.add(p.id);
      for (const filha of listaFinal.filter((x) => x.parentId === p.id)) {
        out.push(filha);
        visto.add(filha.id);
      }
    }
    // Variações cujo pai ficou fora do filtro entram soltas, para não sumirem.
    for (const p of listaFinal) if (!visto.has(p.id)) out.push(p);
    return out;
  }, [listaFinal]);

  const totalPaginas = Math.max(1, Math.ceil(listaAgrupada.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(
    () => listaAgrupada.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [listaAgrupada, paginaAtual],
  );

  // Mudar filtro ou busca sempre devolve à primeira página.
  useEffect(() => { setPagina(1); }, [searchQuery, filtroLinha, filtroValidade]);

  const contagemPorValidade = useMemo(() => {
    const c = { vencido: 0, vencendo: 0, "no-prazo": 0, "sem-controle": 0 };
    for (const p of filteredProducts) {
      c[validadeDe(nearestExpiryByProduct.get(p.id)).status] += 1;
    }
    return c;
  }, [filteredProducts, nearestExpiryByProduct]);

  const openNew = () => {
    setEditing(null);
    const defaultCat = categoryOptions[0] ?? "Geral";
    setForm({ code: "", name: "", category: defaultCat, subcategory: "", priceCents: 0, costCents: 0, barcode: "", minStock: "", stock: "", expiry: "", categoryId: "", parentId: "", variantName: "", unit: "UN", supplierId: "", highlight: false });
    setIsNewCategory(false);
    setIsNewSubcategory(false);
    setOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    const exists = categoryOptions.some((c) => c.toLowerCase() === p.category.toLowerCase());
    setForm({
      code: p.code, name: p.name, category: p.category, subcategory: p.subcategory ?? "",
      priceCents: Math.round(p.price * 100), costCents: Math.round(p.cost * 100), barcode: p.barcode ?? "", unit: p.unit ?? "UN", supplierId: p.supplierId ?? "",
      minStock: p.minStock ? String(p.minStock) : "", stock: String(p.stock), expiry: "",
      categoryId: p.categoryId ?? "", parentId: p.parentId ?? "", variantName: p.variantName ?? "",
      highlight: p.highlight ?? false,
    });
    setIsNewCategory(!exists);
    setIsNewSubcategory(false);
    setOpen(true);
  };

  const formIsErotic = isEroticCategory(form.category);
  /** Produto que agrupa variações não tem preço nem estoque próprios. */
  const agrupaVariacoes = (editing?.variantCount ?? 0) > 0;

  /* Identificação conferida enquanto se digita: o erro aparece com o leitor
     ainda na mão, não depois de salvar. O Rust revalida de todo jeito. */
  const erroSku = useMemo(() => (form.code ? checarSku(form.code) : null), [form.code]);
  const checagemEan = useMemo(() => checarGtin(form.barcode), [form.barcode]);
  const codigosUsados = useMemo(
    () => new Set(products.map((p) => p.code.toUpperCase())),
    [products],
  );
  /** Variações do produto aberto, para o painel dentro do modal. */
  const variacoesDoEditado = useMemo(
    () => (editing ? products.filter((p) => p.parentId === editing.id) : []),
    [products, editing],
  );

  const categoryOptions = useMemo(() => {
    const set = new Set<string>(["Bebidas", "Produtos eróticos", "Pulseiras"]);
    products.forEach((p) => { if (p.category?.trim()) set.add(p.category.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [products]);

  const similarCategory = useMemo(
    () => (isNewCategory ? findSimilarCategory(form.category, categoryOptions) : null),
    [isNewCategory, form.category, categoryOptions],
  );

  const subcategoryOptions = useMemo(() => {
    const set = new Set<string>();
    if (normalize(form.category) === normalize("Bebidas")) {
      ["Skol Beats", "Refrigerante", "Refri Zero", "Red Bull", "Heineken", "Brahma", "Antarctica", "Água S/ Gás", "Água C/ Gás"].forEach((s) => set.add(s));
    }
    products.forEach((p) => {
      if (normalize(p.category) === normalize(form.category) && p.subcategory?.trim()) set.add(p.subcategory.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [products, form.category]);

  const similarSubcategory = useMemo(
    () => (isNewSubcategory ? findSimilarCategory(form.subcategory, subcategoryOptions) : null),
    [isNewSubcategory, form.subcategory, subcategoryOptions],
  );

  const save = async () => {
    const basePayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim() || "Geral",
      subcategory: form.subcategory.trim(),
      price: form.priceCents / 100,
    };
    if (!basePayload.code || !basePayload.name) return toast.error("Código e nome obrigatórios");
    if (isNewCategory) {
      if (!form.category.trim()) return toast.error("Informe o nome da nova categoria");
      if (similarCategory) return toast.error(`A categoria "${similarCategory}" já existe. Selecione-a na lista.`);
    }
    if (isNewSubcategory && form.subcategory.trim() && similarSubcategory) {
      return toast.error(`A subcategoria "${similarSubcategory}" já existe. Selecione-a na lista.`);
    }

    if (!localToken) return toast.error("Sessão local expirada. Entre novamente.");
    const stockQty = parseInt(form.stock, 10) || 0;
    {
      const precisaValidade = isEroticCategory(basePayload.category);
      try {
        if (editing) {
          await desktop.updateProduct(localToken, {
            id: editing.id, code: basePayload.code, name: basePayload.name,
            category: basePayload.category, subcategory: basePayload.subcategory,
            price_cents: centavos(basePayload.price),
            cost_cents: form.costCents,
            barcode: form.barcode.trim() || null,
            unit: form.unit,
            supplier_id: form.supplierId || null,
            min_stock: parseInt(form.minStock, 10) || 0,
            category_id: form.categoryId || null,
            parent_id: form.parentId || null,
            variant_name: form.variantName.trim(),
            highlight: form.highlight,
          });
          toast.success("Produto atualizado");
        } else {
          if (stockQty > 0 && precisaValidade && !form.expiry) {
            return toast.error("Data de validade obrigatória");
          }
          const criado = await desktop.createProduct(localToken, {
            code: basePayload.code, name: basePayload.name,
            category: basePayload.category, subcategory: basePayload.subcategory,
            price_cents: centavos(basePayload.price),
            cost_cents: form.costCents,
            barcode: form.barcode.trim() || null,
            unit: form.unit,
            supplier_id: form.supplierId || null,
            min_stock: parseInt(form.minStock, 10) || 0,
            category_id: form.categoryId || null,
            parent_id: form.parentId || null,
            variant_name: form.variantName.trim(),
            highlight: form.highlight,
          });
          if (stockQty > 0) {
            await desktop.addStock(localToken, {
              product_id: criado.id, quantity: stockQty,
              expiry_date: precisaValidade ? form.expiry : null,
            });
          }
          toast.success("Produto cadastrado");
        }
      } catch (e) {
        return toast.error(typeof e === "string" ? e : "Não foi possível salvar o produto");
      }
    }
    setOpen(false);
    load();
  };

  const remove = async (p: Product) => {
    const ok = await confirmar({
      titulo: `Excluir ${p.name}?`,
      descricao:
        "O produto sai do catálogo e do caixa. O histórico de vendas é preservado, e a exclusão fica registrada em Alterações no estoque.",
      acao: "Excluir produto",
      destrutivo: true,
    });
    if (!ok) return;
    if (!localToken) return toast.error("Sessão local expirada. Entre novamente.");
    try { await desktop.deleteProduct(localToken, p.id); }
    catch (e) { return toast.error(typeof e === "string" ? e : "Não foi possível excluir"); }
    toast.success("Produto excluído");
    load();
  };

  const podeInventariar = pode("stock.inventory");

  /** Abre o diálogo único já no tipo que o botão prometeu. */
  const abrirMovimento = (p: Product, tipo: TipoMovimento) => {
    setMovTipo(tipo);
    setMovAlvo(p);
  };

  const openBatches = (p: Product) => { setBatchesTarget(p); setBatchesOpen(true); };

  const deleteBatch = async (batchId: string) => {
    const lote = batches.find((b) => b.id === batchId);
    const ok = await confirmar({
      titulo: "Descartar este lote?",
      descricao: lote
        ? `${lote.quantity} unidade(s) com validade ${new Date(`${lote.expiry_date}T00:00:00`).toLocaleDateString("pt-BR")} saem do estoque. O movimento fica registrado com o seu nome.`
        : "A quantidade do lote será removida do estoque.",
      acao: "Descartar lote",
      destrutivo: true,
    });
    if (!ok) return;
    if (!localToken) return toast.error("Sessão local expirada. Entre novamente.");
    try { await desktop.deleteBatch(localToken, batchId); }
    catch (e) { return toast.error(typeof e === "string" ? e : "Não foi possível excluir o lote"); }
    toast.success("Lote descartado");
    load();
  };

  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  /**
   * Os três números que o gerente procura ao abrir a tela: quanto tem parado
   * em mercadoria, o que precisa repor e o que está prestes a vencer. Sem
   * isso a tela é uma lista, não um controle de estoque.
   */
  const indicadores = useMemo(() => {
    const vendaveis = products.filter((p) => !p.variantCount);
    const patrimonio = vendaveis.reduce((soma, p) => soma + p.stock * (p.cost || 0), 0);
    const repor = vendaveis.filter((p) => p.stock <= 0 || (p.minStock > 0 && p.stock <= p.minStock));
    const vencendo = vendaveis.filter((p) => {
      const exp = nearestExpiryByProduct.get(p.id);
      if (!exp) return false;
      const dias = daysUntil(exp);
      return dias <= 30;
    });
    return { patrimonio, repor: repor.length, vencendo: vencendo.length };
  }, [products, nearestExpiryByProduct]);

  const renderExpiryCell = (p: Product) => {
    const exp = nearestExpiryByProduct.get(p.id);
    return <StatusValidade validade={validadeDe(exp)} />;
  };


  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-4 pb-3 pt-4 sm:px-6">
        <div>
          <h1 className="text-3xl">Estoque</h1>
          <p className="num text-sm text-muted-foreground">
            {listaFinal.length === products.length
              ? `${products.length} produtos cadastrados`
              : `${listaFinal.length} de ${products.length} produtos`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              placeholder="SKU, EAN, nome ou categoria"
              aria-label="Buscar produto por SKU, código de barras, nome ou categoria"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 w-64 rounded-sm pl-9 xl:w-72"
            />
          </div>
          {canNewProd && (
          <>
            <Button onClick={openNew} className="h-11 rounded-sm">
              <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo produto
            </Button>
            <PainelLateral
              aberto={open}
              onAbertoMudou={setOpen}
              icone={Package}
              titulo={editing ? "Editar produto" : "Novo produto"}
              descricao={
                editing
                  ? "Dados cadastrais, preço e variações."
                  : "O saldo entra depois, por movimento, para ficar registrado."
              }
              selo={editing?.parentId ? "variação" : agrupaVariacoes ? "agrupa variações" : undefined}
              largura="sm:max-w-2xl"
              confirmarDescarte={!!form.name || !!form.code || form.priceCents > 0}
              rodape={
                <>
                  <Button variant="outline" className="h-11 rounded-sm px-5" onClick={() => setOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="ghost"
                    className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
                    onClick={save}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Salvar
                  </Button>
                </>
              }
            >
                {/* Identificação: quem é o produto e por qual número ele é achado. */}
                <SecaoForm titulo="Identificação">
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pnome">Nome</Label>
                      <Input
                        id="pnome"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Ex.: Gel Dessensibilizante"
                        className="campo h-11 rounded-sm"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem]">
                      <CampoSku
                        id="pcode"
                        valor={form.code}
                        erro={erroSku}
                        onChange={(v) => setForm({ ...form, code: v })}
                        onSugerir={() =>
                          setForm({
                            ...form,
                            code: sugerirSku(form.category, form.name, codigosUsados),
                          })
                        }
                      />
                      <CampoGtin
                        id="pean"
                        valor={form.barcode}
                        checagem={checagemEan}
                        onChange={(v) => setForm({ ...form, barcode: v })}
                      />
                      <CampoUnidade
                        id="punidade"
                        valor={form.unit}
                        onChange={(v) => setForm({ ...form, unit: v })}
                      />
                    </div>
                  </div>
                  {/* Piscar: a tela de venda avisa em vermelho e branco quando o item está no pedido. */}
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5 border border-border p-2.5">
                    <input
                      type="checkbox"
                      className="marcador mt-0.5 shrink-0"
                      checked={form.highlight}
                      onChange={(e) => setForm({ ...form, highlight: e.target.checked })}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">Piscar na venda</span>
                      <span className="block text-xs text-muted-foreground">
                        A tela do caixa pisca em vermelho e branco enquanto este produto estiver no
                        pedido, como a pulseira. Ligar na categoria vale para todos os produtos dela.
                      </span>
                    </span>
                  </label>
                </SecaoForm>

                <SecaoForm titulo="Classificação">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CampoCategoria
                      categorias={categorias}
                      valor={form.categoryId}
                      onChange={(v) => setForm({ ...form, categoryId: v })}
                      podeCriar={canNewProd}
                      onCriar={(pai) => setCriarCategoriaEm({ pai })}
                    />

                    {pode("suppliers.view") && (
                      <Selecao
                        id="pforn"
                        rotulo="Fornecedor habitual"
                        valor={form.supplierId}
                        onChange={(v) => setForm({ ...form, supplierId: v })}
                        placeholder="Nenhum"
                        ajuda="Sugestão para a entrada de estoque. Cada compra grava o fornecedor dela."
                        opcoes={[
                          { valor: "", rotulo: "— nenhum —" },
                          ...fornecedores.map((f) => ({ valor: f.id, rotulo: f.name })),
                        ]}
                      />
                    )}
                  </div>
                </SecaoForm>

                {/* Preço e custo: um produto que só agrupa não é vendido, então some. */}
                {agrupaVariacoes ? (
                  <SecaoForm titulo="Preço e estoque">
                    <div className="placa flex items-start gap-3 p-4">
                      <Layers className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                      <p className="text-sm text-muted-foreground">
                        Este produto agrupa {editing?.variantCount} variação(ões) e não é vendido
                        direto. Preço, custo, código de barras e estoque pertencem a cada variação.
                      </p>
                    </div>
                  </SecaoForm>
                ) : (
                  <>
                    <SecaoForm titulo="Preço">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <CampoMoeda
                          id="pvenda"
                          rotulo="Preço de venda"
                          centavos={form.priceCents}
                          onChange={(c) => setForm({ ...form, priceCents: c })}
                        />
                        <CampoMoeda
                          id="pcusto"
                          rotulo="Custo de compra"
                          centavos={form.costCents}
                          onChange={(c) => setForm({ ...form, costCents: c })}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {(() => {
                          const v = form.priceCents;
                          const c = form.costCents;
                          if (!v || !c) return "Informe custo para acompanhar a margem nos relatórios.";
                          const m = ((v - c) / v) * 100;
                          return `Margem de ${m.toFixed(1)}% · lucro de ${fmt((v - c) / 100)} por unidade`;
                        })()}
                      </p>
                    </SecaoForm>

                    <SecaoForm titulo="Estoque">
                      {/* O EAN saiu daqui: identificação é identificação, e ter
                          dois campos de código de barras no mesmo formulário era
                          convite para preencher o errado. */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="pmin">Estoque mínimo</Label>
                          <Input
                            id="pmin"
                            type="number"
                            min="0"
                            step="1"
                            value={form.minStock}
                            onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                            className="campo num h-11 rounded-sm"
                          />
                        </div>
                        {!editing && (
                          <div className="space-y-1.5">
                            <Label htmlFor="pqtd">Quantidade inicial</Label>
                            <Input
                              id="pqtd"
                              type="number"
                              min="0"
                              step="1"
                              value={form.stock}
                              onChange={(e) => setForm({ ...form, stock: e.target.value })}
                              className="campo num h-11 rounded-sm"
                            />
                          </div>
                        )}
                      </div>

                      {!editing && (parseInt(form.stock, 10) || 0) > 0 && formIsErotic && (
                        <div className="mt-3 space-y-1.5">
                          <Label htmlFor="pval">Data de validade (obrigatória)</Label>
                          <Input
                            id="pval"
                            type="date"
                            min={todayISO()}
                            value={form.expiry}
                            onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                            className="campo h-11 w-52 rounded-sm"
                          />
                          <p className="text-xs text-muted-foreground">
                            Toda categoria exige validade por lote, exceto Pulseiras.
                          </p>
                        </div>
                      )}

                      {editing && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          O saldo não é editado aqui: use <strong>Registrar movimento</strong> na
                          linha do produto, para que toda entrada e saída fique registrada.
                        </p>
                      )}
                    </SecaoForm>
                  </>
                )}

                {/* Variações nascem de dentro do pai: é assim que se pensa o
                    catálogo, e cada uma leva o próprio GTIN, como a GS1 exige. */}
                {editing && !editing.parentId && (
                  <PainelVariacoes
                    pai={{ id: editing.id, name: form.name || editing.name }}
                    variacoes={variacoesDoEditado}
                    categoriaId={form.categoryId || editing.categoryId || null}
                    categoria={form.category}
                    codigosUsados={codigosUsados}
                    podeCriar={canNewProd}
                    onMudou={load}
                  />
                )}

            </PainelLateral>
          </>
        )}
      </div>
      </div>

      {/* Estoque tem duas faces: os produtos e a estrutura que os organiza. */}
      <nav className="trilho flex shrink-0 gap-1 px-4 pt-2 sm:px-6" aria-label="Seções do estoque">
        {([["produtos", "Produtos"], ["categorias", "Categorias"], ["fornecedores", "Fornecedores"]] as const).map(([id, rotulo]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            aria-current={aba === id ? "page" : undefined}
            className={cn(
              "rotulo h-11 border px-4 text-[12px] transition-colors",
              aba === id
                ? "border-transparent bg-secondary text-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "fornecedores" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <GestaoFornecedores podeGerir={pode("suppliers.manage")} />
        </div>
      ) : aba === "categorias" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <GestaoCategorias
            podeCriar={canNewProd}
            podeEditar={canEditProd}
            podeDesativar={canDeleteProd}
            onMudou={() => { carregarCategorias(); load(); }}
          />
        </div>
      ) : (
      <>
      {/* Painel de leitura: os três números antes da lista. */}
      <div className="grid shrink-0 gap-3 px-4 pb-3 sm:grid-cols-3 sm:px-6">
        <Indicador
          rotulo="Patrimônio em estoque"
          valor={fmt(indicadores.patrimonio)}
          nota="Saldo × custo de compra"
          icone={<Boxes className="h-4 w-4" aria-hidden />}
        />
        <Indicador
          rotulo="Precisa repor"
          valor={String(indicadores.repor)}
          nota="Zerado ou abaixo do mínimo"
          cor={indicadores.repor > 0 ? "var(--warning)" : undefined}
          icone={<TrendingDown className="h-4 w-4" aria-hidden />}
        />
        <Indicador
          rotulo="Vence em 30 dias"
          valor={String(indicadores.vencendo)}
          nota="Lote mais próximo do vencimento"
          cor={indicadores.vencendo > 0 ? "var(--destructive)" : undefined}
          icone={<AlertTriangle className="h-4 w-4" aria-hidden />}
        />
      </div>

      {/* Filtros de balcão: linha e status de validade, com contagem. */}
      <div className="trilho flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-1.5">
          <Rotulo className="mr-1">Linha</Rotulo>
          <FiltroBotao ativo={filtroLinha === "todas"} onClick={() => setFiltroLinha("todas")}>
            Todas
          </FiltroBotao>
          {(["pulseira", "bebida", "erotico"] as const).map((l) => (
            <FiltroBotao key={l} ativo={filtroLinha === l} onClick={() => setFiltroLinha(l)} cor={corDaLinha[l]}>
              {nomeDaLinha[l]}
            </FiltroBotao>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Rotulo className="mr-1">Validade</Rotulo>
          <FiltroBotao ativo={filtroValidade === "todos"} onClick={() => setFiltroValidade("todos")}>
            Todas
          </FiltroBotao>
          <FiltroBotao
            ativo={filtroValidade === "vencido"}
            onClick={() => setFiltroValidade("vencido")}
            cor="var(--destructive)"
          >
            Vencidos {contagemPorValidade.vencido}
          </FiltroBotao>
          <FiltroBotao
            ativo={filtroValidade === "vencendo"}
            onClick={() => setFiltroValidade("vencendo")}
            cor="var(--warning)"
          >
            Vencendo {contagemPorValidade.vencendo}
          </FiltroBotao>
        </div>
      </div>

      <div className="painel mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden sm:mx-6">
        <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("code")}>
                <div className="flex items-center gap-1">SKU / EAN
                  {sort.column === "code" ? (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("name")}>
                <div className="flex items-center gap-1">Nome
                  {sort.column === "name" ? (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("category")}>
                <div className="flex items-center gap-1">Categoria
                  {sort.column === "category" ? (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
              <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("price")}>
                <div className="flex items-center justify-end gap-1">Preço
                  {sort.column === "price" ? (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
              <TableHead className="text-right">Últ. compra</TableHead>
              <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("stock")}>
                <div className="flex items-center justify-end gap-1">Estoque
                  {sort.column === "stock" ? (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("expiry")}>
                <div className="flex items-center gap-1">Validade
                  {sort.column === "expiry" ? (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
              <TableHead className="w-[180px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {/* SKU e EAN juntos: são as duas formas de achar o produto,
                      uma digitada e outra lida, e viviam em telas diferentes. */}
                  <div className="num leading-tight">
                    <div className="text-[13px]">{p.code}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.barcode ?? "—"}
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn("font-semibold", p.parentId && "pl-8 font-medium")}>
                  <span className="flex items-center gap-2">
                    {p.parentId && (
                      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span>
                      {p.parentId ? (p.variantName || p.name) : p.name}
                      {!p.parentId && (p.variantCount ?? 0) > 0 && (
                        <span className="rotulo ml-2 text-[10px] text-muted-foreground">
                          {p.variantCount} variação(ões) · não vendido direto
                        </span>
                      )}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <SeloLinha categoria={p.category} />
                    {p.subcategory?.trim() && (
                      <span className="rotulo text-[10px]" style={{ color: "var(--painel-muted)" }}>
                        {p.subcategory}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="num leading-tight tabular-nums">
                    <div>{fmt(Number(p.price))}</div>
                    {p.cost > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        custo {fmt(p.cost)}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {/* Última compra: quanto se pagou e de quem, para saber se o
                      custo médio subiu por causa de uma compra específica. */}
                  {p.lastPurchaseCents == null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="num leading-tight tabular-nums">
                      <div className="text-[13px]">{fmt(p.lastPurchaseCents / 100)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.supplierName ?? "sem fornecedor"}
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1.5">
                    {p.minStock > 0 && p.stock <= p.minStock && p.stock > 0 && (
                      <TrendingDown
                        className="h-3.5 w-3.5"
                        style={{ color: "var(--warning)" }}
                        aria-label={`Abaixo do mínimo de ${p.minStock}`}
                      />
                    )}
                    <span
                      className="rotulo num text-[13px]"
                      title={p.minStock > 0 ? `Mínimo: ${p.minStock}` : undefined}
                      style={{
                        color:
                          p.stock <= 0
                            ? "var(--destructive)"
                            : p.minStock > 0 && p.stock <= p.minStock
                              ? "var(--warning)"
                              : "var(--foreground)",
                      }}
                    >
                      {p.stock}
                    </span>
                    <span className="rotulo text-[10px] text-muted-foreground">
                      {p.unit ?? "UN"}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {renderExpiryCell(p)}
                    {(batchesByProduct.get(p.id)?.length ?? 0) > 0 && canBatches && (
                      <BotaoAcao
                        rotulo="Gerenciar lotes"
                        onClick={() => openBatches(p)}
                        className={`h-11 w-11 ${(batchesByProduct.get(p.id) ?? []).some(b => daysUntil(b.expiry_date) < 0) ? "text-destructive" : ""}`}
                      >
                        <Layers className="h-4 w-4" />
                      </BotaoAcao>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {/*
                   * Duas ações no dedo, o resto atrás de um menu com rótulo em
                   * texto: seis ícones lado a lado quebravam a célula e a
                   * tooltip não é caminho de leitura em tela de toque.
                   */}
                  <div className="flex items-center justify-end gap-1">
                    {canAdd && (
                      <BotaoAcao rotulo="Registrar movimento" onClick={() => abrirMovimento(p, "entrada")}>
                        <PackagePlus className="h-4 w-4" />
                      </BotaoAcao>
                    )}
                    {canEditProd && (
                      <BotaoAcao rotulo="Editar produto" onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </BotaoAcao>
                    )}
                    {(podeInventariar || canRemove || canDeleteProd) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            aria-label={`Mais ações de ${p.name}`}
                            className="h-11 w-11 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 rounded-sm">
                          {podeInventariar && (
                            <DropdownMenuItem
                              className="h-11"
                              onSelect={() => abrirMovimento(p, "inventario")}
                            >
                              <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden /> Inventariar
                            </DropdownMenuItem>
                          )}
                          {canRemove && (
                            <DropdownMenuItem className="h-11" onSelect={() => abrirMovimento(p, "saida")}>
                              <Minus className="mr-2 h-4 w-4" aria-hidden /> Remover do estoque
                            </DropdownMenuItem>
                          )}
                          {canDeleteProd && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="h-11 text-destructive focus:text-destructive"
                                onSelect={() => remove(p)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Excluir produto
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!visiveis.length && (
              <TableRow>
                <TableCell colSpan={8} className="py-16 text-center text-muted-foreground">
                  {products.length === 0
                    ? `Nenhum produto cadastrado.${canNewProd ? " Clique em Novo produto." : ""}`
                    : "Nenhum produto corresponde a esta busca ou filtro."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>

        {/* Paginação: ancorada na base do painel, como o rodapé de um quadro. */}
        {totalPaginas > 1 && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
            <span className="rotulo num text-[11px] text-muted-foreground">
              {(paginaAtual - 1) * POR_PAGINA + 1}–{Math.min(paginaAtual * POR_PAGINA, listaAgrupada.length)} de {listaAgrupada.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-sm px-3"
                disabled={paginaAtual === 1}
                onClick={() => setPagina(paginaAtual - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setPagina(n)}
                  aria-current={n === paginaAtual ? "page" : undefined}
                  aria-label={`Página ${n}`}
                  className={cn(
                    "num h-10 min-w-10 border px-2 text-sm font-semibold transition-colors",
                    n === paginaAtual
                      ? "border-transparent bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-sm px-3"
                disabled={paginaAtual === totalPaginas}
                onClick={() => setPagina(paginaAtual + 1)}
                aria-label="Próxima página"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>

      </>
      )}

      {/* Inventário: a contagem física manda, e a diferença fica registrada. */}



      <DrawerCategoria
        aberto={!!criarCategoriaEm}
        paiId={criarCategoriaEm?.pai ?? null}
        categorias={categorias}
        onFechar={() => setCriarCategoriaEm(null)}
        onCriada={async (criada) => {
          await carregarCategorias();
          // Já deixa escolhida: quem criou a categoria queria usá-la agora.
          setForm((f) => ({ ...f, categoryId: criada.id }));
        }}
      />

      <DialogoMovimento
        alvo={movAlvo}
        lotes={movAlvo ? (batchesByProduct.get(movAlvo.id) ?? []) : []}
        exigeValidade={movAlvo ? isEroticCategory(movAlvo.category) : false}
        pode={pode}
        fornecedores={fornecedores}
        fornecedorPadrao={movAlvo?.supplierId ?? ""}
        tipoInicial={movTipo}
        onFechar={() => setMovAlvo(null)}
        onPronto={load}
      />

      <Dialog open={batchesOpen} onOpenChange={setBatchesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lotes {batchesTarget ? `— ${batchesTarget.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {batchesTarget && (batchesByProduct.get(batchesTarget.id) ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum lote cadastrado.</p>
            )}
            {batchesTarget && (batchesByProduct.get(batchesTarget.id) ?? []).map((b) => {
              const days = daysUntil(b.expiry_date);
              const expired = days < 0;
              return (
                <div key={b.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={expired ? "destructive" : days <= 45 ? "outline" : "secondary"} className={!expired && days <= 45 ? "border-destructive text-destructive" : ""}>
                      {expired && <AlertTriangle className="mr-1 h-3 w-3" />}
                      {fmtDate(b.expiry_date)}
                    </Badge>
                    <span className="text-sm">Qtd: <strong>{b.quantity}</strong></span>
                    {expired && <span className="text-xs text-destructive font-semibold uppercase">Vencido</span>}
                  </div>
                  {expired ? (
                    <Button size="sm" variant="destructive" onClick={() => deleteBatch(b.id)}>
                      <Trash2 className="mr-1 h-3 w-3" /> Excluir
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{days} dia(s)</span>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground pt-2">
              Apenas lotes vencidos podem ser excluídos. A quantidade do lote será subtraída do estoque e registrada em Relatórios → Alterações no estoque.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchesOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Botão de filtro do balcão: alvo generoso, estado marcado por chapa e cor de linha. */
function FiltroBotao({
  ativo,
  onClick,
  children,
  cor,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  cor?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "rotulo flex h-9 items-center gap-1.5 border px-2.5 text-[11px] transition-colors",
        ativo
          ? "border-transparent bg-secondary text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {cor && <span aria-hidden className="h-2.5 w-2.5 shrink-0" style={{ background: cor }} />}
      {children}
    </button>
  );
}

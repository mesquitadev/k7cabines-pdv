import { invoke } from "@tauri-apps/api/core";

/**
 * Chave do papel. É texto livre porque perfis são cadastrados pelo usuário:
 * fixar os quatro nomes de fábrica faria qualquer perfil novo não compilar.
 */
export type LocalRole = string;

export interface LocalUser {
  id: string;
  username: string;
  full_name: string;
  whatsapp: string | null;
  role: LocalRole;
  permissions: string[];
  must_change_password: boolean;
}

export interface LocalSession {
  token: string;
  user: LocalUser;
}

export interface LocalProduct {
  id: string;
  code: string;
  name: string;
  category: string;
  subcategory: string;
  price_cents: number;
  cost_cents: number;
  barcode: string | null;
  min_stock: number;
  category_id: string | null;
  parent_id: string | null;
  variant_name: string;
  variant_count: number;
  /** Unidade de medida: UN, CX, PC, PAR, ML ou G. */
  unit: string;
  supplier_id: string | null;
  supplier_name: string | null;
  last_purchase_at: string | null;
  last_purchase_cents: number | null;
  /** Ligado no produto: a venda pisca quando ele está no pedido. */
  highlight: boolean;
  /** Efetivo: do produto OU da categoria. */
  highlight_effective: boolean;
  stock_quantity: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Uma ficha: o que o cliente pagou e ainda não retirou. */
export interface LocalCreditVoucher {
  id: string;
  sale_id: string;
  sale_number: number;
  customer_name: string;
  /** Código curto que identifica a ficha ao portador (impresso como K7-XXXX). */
  code: string;
  created_at: string;
  settled_at: string | null;
  items: LocalCreditVoucherItem[];
}

export interface LocalCreditVoucherItem {
  id: string;
  product_id: string | null;
  product_name: string;
  category: string;
  quantity: number;
  taken_quantity: number;
}

/** O que saiu no turno, do total para o item. */
export interface LocalVendasDoTurno {
  total_cents: number;
  unidades: number;
  categorias: LocalCategoriaVendida[];
}

export interface LocalCategoriaVendida {
  categoria: string;
  total_cents: number;
  unidades: number;
  subcategorias: LocalSubcategoriaVendida[];
}

export interface LocalSubcategoriaVendida {
  subcategoria: string;
  total_cents: number;
  unidades: number;
  produtos: LocalProdutoVendido[];
}

export interface LocalProdutoVendido {
  produto: string;
  unidades: number;
  total_cents: number;
}

/** Demonstrativo de resultado do período. */
export interface LocalDre {
  receita_bruta_cents: number;
  descontos_cents: number;
  devolucoes_cents: number;
  receita_liquida_cents: number;
  cmv_cents: number;
  lucro_bruto_cents: number;
  margem_percentual: number;
  /** Itens vendidos sem custo gravado: enquanto houver, o CMV está incompleto. */
  itens_sem_custo: number;
  itens_total: number;
  vendas: number;
  unidades: number;
  ticket_medio_cents: number;
  dinheiro_cents: number;
  cartao_cents: number;
  pix_cents: number;
  troco_cents: number;
  por_categoria: LocalDreCategoria[];
  por_dia: LocalDreDia[];
}

export interface LocalDreCategoria {
  categoria: string;
  receita_cents: number;
  cmv_cents: number;
  lucro_cents: number;
  margem_percentual: number;
  participacao_percentual: number;
  unidades: number;
  itens_sem_custo: number;
}

export interface LocalDreDia {
  dia: string;
  receita_cents: number;
  cmv_cents: number;
  lucro_cents: number;
  vendas: number;
}

/** Configuração da impressora desta estação. */
export interface LocalPrinterSettings {
  printer_name: string;
  paper_width_mm: number;
  columns: number;
  copies: number;
  feed_lines: number;
  cut_paper: boolean;
  open_drawer: boolean;
  /** "escpos" imprime direto, "texto" manda sem comandos, "navegador" usa o diálogo. */
  mode: "escpos" | "texto" | "navegador";
  codepage: number;
  /** Imprimir o cupom sozinho ao emitir a venda. */
  auto_print_sale: boolean;
  /** Imprimir a ficha sozinha quando a venda deixa item para retirar. */
  auto_print_credit: boolean;
  /** Vias da ficha: uma para o cliente, outra para o balcão. */
  credit_copies: number;
}

export interface LocalSupplier {
  id: string;
  name: string;
  document: string | null;
  phone: string;
  email: string;
  notes: string;
  active: boolean;
  product_count: number;
  last_purchase_at: string | null;
}

export interface LocalSupplierPurchase {
  occurred_at: string;
  product_name: string;
  variant_name: string;
  quantity: number;
  unit_cost_cents: number | null;
  reason: string;
  actor_name: string;
}

export interface LocalSupplierInput {
  name: string;
  document?: string | null;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface LocalSaleItemInput {
  product_id: string;
  quantity: number;
  /** Item pago agora e retirado depois: não baixa estoque na venda. */
  credit?: boolean;
}

export interface FinalizeSaleInput {
  client_sale_id: string;
  items: LocalSaleItemInput[];
  cash_tendered_cents: number;
  card_cents: number;
  /** Recebido em PIX. O Rust valida junto com os outros meios. */
  pix_cents?: number;
  /** Desconto no total. Exige motivo por escrito. */
  discount_cents?: number;
  /** Por que o desconto foi dado. Obrigatório quando há desconto. */
  discount_reason?: string;
  /** Nome do cliente, opcional. Sai no fechamento junto do desconto. */
  customer_name?: string;
  /** Nome pelo qual a ficha será encontrada na retirada. */
  credit_customer?: string | null;
}

export interface CompletedSaleItem {
  product_id: string;
  product_code: string;
  product_name: string;
  category: string;
  unit_price_cents: number;
  quantity: number;
  subtotal_cents: number;
}

export interface CompletedSale {
  id: string;
  client_sale_id: string;
  sale_number: number;
  business_date: string;
  total_cents: number;
  cash_tendered_cents: number;
  card_cents: number;
  pix_cents: number;
  discount_cents: number;
  change_cents: number;
  operator_name: string;
  created_at: string;
  items: CompletedSaleItem[];
}

export interface LocalBatch {
  id: string;
  product_id: string;
  expiry_date: string;
  quantity: number;
}

export interface LocalTicketSettings {
  store_name: string;
  fiscal_label: string;
  footer_message: string;
  show_chapelaria: boolean;
  chapelaria_label: string;
  show_datetime: boolean;
  show_operator: boolean;
  operator_label: string;
  pix_key: string;
  pix_merchant_name: string;
  pix_merchant_city: string;
  legal_name: string;
  document: string;
  phone: string;
  address_line: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  contact_line: string;
}

export interface ReportRange { from: string; to: string }

export interface ReportSale {
  id: string; sale_number: number; created_at: string; operator_name: string;
  items_count: number; total_cents: number; cash_cents: number; card_cents: number;
  discount_cents: number; discount_reason: string; customer_name: string;
}
export interface ReportItem {
  sale_id: string; category: string; subcategory: string; product_name: string;
  quantity: number; subtotal_cents: number; created_at: string;
}
export interface ReportMovement {
  id: string; product_name: string; delta: number; reason: string;
  actor_name: string; occurred_at: string;
}
export interface ReportDeletedSale {
  sale_number: number; total_cents: number; operator_name: string;
  deleted_by_name: string; reason: string; deleted_at: string;
}

export interface ManagedUser {
  id: string;
  username: string;
  full_name: string;
  whatsapp: string | null;
  role: LocalRole;
  last_login_at: string | null;
  permissions: string[];
  /** Conta master permanente: indelével, não desativável, não rebaixável. */
  is_permanent: boolean;
  must_change_password: boolean;
}

/** Áreas de dados: cada uma sai num arquivo próprio e pode ser limpa em separado. */
export type DataArea = "vendas" | "estoque" | "sistema";
export interface DataAreaFile { area: DataArea; path: string; file_name: string; size_bytes: number; linhas: number; }
export interface DataImportSummary { area: DataArea; linhas: number; tabelas: number; }
export interface DataPurgeSummary { area: DataArea; antes_de: string; apagadas: number; backup: BackupFile; }

export interface BackupFile {
  path: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
}

export interface LocalRoleInfo {
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  is_master: boolean;
  permissions: string[];
  /** Contas ativas com este papel. Zero é o que permite excluir. */
  user_count: number;
  /** Dias de histórico de vendas visíveis nos relatórios. 0 = tudo. */
  history_days: number;
}

export interface LocalPermissionInfo {
  key: string;
  grupo: string;
  rotulo: string;
  descricao: string;
}

export interface CashSession {
  id: string;
  opened_at: string;
  opened_by_name: string;
  opening_float_cents: number;
  closed_at: string | null;
  closed_by_name: string | null;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  difference_cents: number | null;
  /** Encerrado sem contar a gaveta, na virada de dia. */
  closed_without_count?: boolean;
  notes: string | null;
  status: "aberta" | "fechada";
}

export interface CashSessionSummary {
  session_id: string;
  status: string;
  opening_float_cents: number;
  cash_cents: number;
  card_cents: number;
  pix_cents: number;
  total_sales_cents: number;
  sales_count: number;
  withdrawals_cents: number;
  deposits_cents: number;
  refunds_cash_cents: number;
  esperado_cents: number;
}

export interface CashMovementInfo {
  id: string;
  kind: "sangria" | "suprimento";
  amount_cents: number;
  reason: string;
  actor_name: string;
  occurred_at: string;
}

export interface SetupStatus {
  setup_completed: boolean;
  /** O roteiro de configuração inicial já foi fechado pelo master. */
  onboarding_completed: boolean;
  installation_id: string;
  store_name: string;
  store_city: string;
}

export interface TemplateResumo {
  origem_loja: string;
  produtos_criados: number;
  produtos_atualizados: number;
  contas_criadas: number;
  papeis_aplicados: number;
}

export interface SaleItemForReturn {
  sale_item_id: string;
  product_name: string;
  quantity: number;
  returned_quantity: number;
  unit_price_cents: number;
}

export interface SystemParam {
  key: string;
  value: string;
  tipo: "inteiro" | "texto" | "booleano";
  grupo: string;
  rotulo: string;
  descricao: string;
  minimo: number | null;
  maximo: number | null;
}

export interface LocalCategory {
  id: string;
  name: string;
  parent_id: string | null;
  color: string;
  sort_order: number;
  active: boolean;
  product_count: number;
  /** Todos os produtos da categoria fazem a venda piscar. */
  highlight: boolean;
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const desktop = {
  appInfo: () => invoke<{ schema_version: number; database_ready: boolean; product_name: string; version: string }>("app_info"),
  setupStatus: () => invoke<SetupStatus>("setup_status"),
  completeSetup: (input: { store_name: string; store_city: string; master_password: string }) =>
    invoke<LocalSession>("complete_setup", { input }),
  login: (input: { username: string; password: string }) => invoke<LocalSession>("login", { input }),
  currentSession: (token: string) => invoke<LocalUser>("current_session", { token }),
  logout: (token: string) => invoke<void>("logout", { token }),
  listProducts: (token: string) => invoke<LocalProduct[]>("list_products", { token }),
  createProduct: (
    token: string,
    input: { code: string; name: string; category: string; subcategory?: string; price_cents: number; cost_cents?: number; barcode?: string | null; min_stock?: number; category_id?: string | null; parent_id?: string | null; variant_name?: string; unit?: string; supplier_id?: string | null; highlight?: boolean },
  ) => invoke<LocalProduct>("create_product", { token, input }),
  finalizeSale: (token: string, input: FinalizeSaleInput) =>
    invoke<CompletedSale>("finalize_sale", { token, input }),
  saleByClientId: (token: string, clientSaleId: string) =>
    invoke<CompletedSale | null>("sale_by_client_id", { token, clientSaleId }),
  listBatches: (token: string) => invoke<LocalBatch[]>("list_batches", { token }),
  updateProduct: (
    token: string,
    input: { id: string; code: string; name: string; category: string; subcategory?: string | null; price_cents: number; cost_cents?: number; barcode?: string | null; min_stock?: number; category_id?: string | null; parent_id?: string | null; variant_name?: string; unit?: string; supplier_id?: string | null; highlight?: boolean },
  ) => invoke<LocalProduct>("update_product", { token, input }),
  deleteProduct: (token: string, productId: string) =>
    invoke<void>("delete_product", { token, productId }),
  addStock: (
    token: string,
    input: {
      product_id: string;
      quantity: number;
      expiry_date?: string | null;
      unit_cost_cents?: number | null;
      note?: string | null;
      supplier_id?: string | null;
    },
  ) =>
    invoke<void>("add_stock", { token, input }),
  removeStock: (token: string, input: { product_id: string; quantity: number; note?: string | null }) =>
    invoke<void>("remove_stock", { token, input }),
  deleteBatch: (token: string, batchId: string) => invoke<void>("delete_batch", { token, batchId }),

  getTicketSettings: (token: string) => invoke<LocalTicketSettings>("get_ticket_settings", { token }),
  saveTicketSettings: (token: string, input: LocalTicketSettings) =>
    invoke<LocalTicketSettings>("save_ticket_settings", { token, input }),

  reportSales: (token: string, range: ReportRange) => invoke<ReportSale[]>("report_sales", { token, range }),
  reportItems: (token: string, range: ReportRange) => invoke<ReportItem[]>("report_items", { token, range }),
  reportMovements: (token: string, range: ReportRange) => invoke<ReportMovement[]>("report_movements", { token, range }),
  reportDeletedSales: (token: string, range: ReportRange) =>
    invoke<ReportDeletedSale[]>("report_deleted_sales", { token, range }),
  deleteSale: (token: string, input: { sale_id: string; reason: string }) =>
    invoke<void>("delete_sale", { token, input }),

  listUsers: (token: string) => invoke<ManagedUser[]>("list_users", { token }),
  createUser: (token: string, input: { username: string; password: string; full_name: string; whatsapp?: string | null; role: LocalRole }) =>
    invoke<ManagedUser>("create_user", { token, input }),
  updateUser: (token: string, input: { user_id: string; full_name?: string | null; whatsapp?: string | null; role?: LocalRole | null; permissions?: Record<string, boolean> | null }) =>
    invoke<ManagedUser>("update_user", { token, input }),
  setUserPassword: (token: string, userId: string, password: string) =>
    invoke<void>("set_user_password", { token, userId, password }),
  deleteUser: (token: string, userId: string) => invoke<void>("delete_user", { token, userId }),

  changeOwnPassword: (token: string, input: { current_password: string; new_password: string }) =>
    invoke<void>("change_own_password", { token, input }),
  listRoles: (token: string) => invoke<LocalRoleInfo[]>("list_roles", { token }),
  listPermissions: (token: string) => invoke<LocalPermissionInfo[]>("list_permissions", { token }),

  cashOpenSession: (token: string) => invoke<CashSession | null>("cash_open_session", { token }),
  cashOpen: (token: string, openingFloatCents: number) =>
    invoke<CashSession>("cash_open", { token, openingFloatCents }),
  cashMove: (token: string, kind: "sangria" | "suprimento", amountCents: number, reason: string) =>
    invoke<CashSession>("cash_move", { token, kind, amountCents, reason }),
  cashSummary: (token: string, sessionId: string) =>
    invoke<CashSessionSummary>("cash_summary", { token, sessionId }),
  cashMovements: (token: string, sessionId: string) =>
    invoke<CashMovementInfo[]>("cash_movements", { token, sessionId }),
  cashClose: (token: string, countedCents: number, notes?: string | null) =>
    invoke<CashSession>("cash_close", { token, countedCents, notes: notes ?? null }),

  exportTemplate: (token: string, destino: string) =>
    invoke<string>("export_template", { token, destino }),
  importTemplate: (token: string, origem: string) =>
    invoke<TemplateResumo>("import_template", { token, origem }),
  saleItemsForReturn: (token: string, saleId: string) =>
    invoke<SaleItemForReturn[]>("sale_items_for_return", { token, saleId }),
  returnSaleItem: (token: string, input: {
      sale_item_id: string;
      quantity: number;
      refund_kind: string;
      reason: string;
      restock: boolean;
      /** Chave de idempotência: dois cliques devolvem uma vez só. */
      client_return_id?: string;
    }) =>
    invoke<void>("return_sale_item", { token, input }),
  inventoryCount: (token: string, input: { product_id: string; counted_quantity: number; reason: string }) =>
    invoke<void>("inventory_count", { token, input }),

  listCategories: (token: string) => invoke<LocalCategory[]>("list_categories", { token }),
  clearUserExceptions: (token: string, userId: string) =>
    invoke<ManagedUser>("clear_user_exceptions", { token, userId }),
  /** Primeira data que o usuário logado pode consultar; null = sem limite. */
  reportEarliestDate: (token: string) => invoke<string | null>("report_earliest_date", { token }),
  createRole: (token: string, input: { name: string; description?: string; permissions: string[]; history_days?: number }) =>
    invoke<LocalRoleInfo>("create_role", { token, input }),
  updateRole: (
    token: string,
    roleKey: string,
    input: { name: string; description?: string; permissions: string[]; history_days?: number },
  ) => invoke<LocalRoleInfo>("update_role", { token, roleKey, input }),
  deleteRole: (token: string, roleKey: string) => invoke<void>("delete_role", { token, roleKey }),

  reportDre: (token: string, range: ReportRange) => invoke<LocalDre>("report_dre", { token, range }),
  deleteCategory: (token: string, categoryId: string) =>
    invoke<void>("delete_category", { token, categoryId }),

  listSystemPrinters: (token: string) => invoke<string[]>("list_system_printers", { token }),
  getPrinterSettings: (token: string) => invoke<LocalPrinterSettings>("get_printer_settings", { token }),
  savePrinterSettings: (token: string, input: LocalPrinterSettings) =>
    invoke<LocalPrinterSettings>("save_printer_settings", { token, input }),
  printTestPage: (token: string) => invoke<void>("print_test_page", { token }),
  printSaleReceipt: (token: string, saleId: string) =>
    invoke<void>("print_sale_receipt", { token, saleId }),
  openCashDrawer: (token: string) => invoke<void>("open_cash_drawer", { token }),

  listSuppliers: (token: string) => invoke<LocalSupplier[]>("list_suppliers", { token }),
  createSupplier: (token: string, input: LocalSupplierInput) =>
    invoke<LocalSupplier>("create_supplier", { token, input }),
  updateSupplier: (token: string, supplierId: string, input: LocalSupplierInput) =>
    invoke<LocalSupplier>("update_supplier", { token, supplierId, input }),
  deactivateSupplier: (token: string, supplierId: string) =>
    invoke<void>("deactivate_supplier", { token, supplierId }),
  reactivateSupplier: (token: string, supplierId: string) =>
    invoke<void>("reactivate_supplier", { token, supplierId }),
  supplierPurchases: (token: string, supplierId: string, limit = 50) =>
    invoke<LocalSupplierPurchase[]>("supplier_purchases", { token, supplierId, limit }),

  createCategory: (token: string, input: { name: string; parent_id?: string | null; color?: string; sort_order?: number; highlight?: boolean }) =>
    invoke<LocalCategory>("create_category", { token, input }),
  updateCategory: (token: string, id: string, input: { name: string; parent_id?: string | null; color?: string; sort_order?: number; highlight?: boolean }) =>
    invoke<LocalCategory>("update_category", { token, id, input }),
  deactivateCategory: (token: string, id: string) =>
    invoke<void>("deactivate_category", { token, id }),

  listParams: (token: string) => invoke<SystemParam[]>("list_params", { token }),
  setOnboarding: (token: string, completed: boolean) =>
    invoke<SetupStatus>("set_onboarding", { token, completed }),
  setParam: (token: string, key: string, value: string) =>
    invoke<void>("set_param", { token, key, value }),

  listBackups: (token: string) => invoke<BackupFile[]>("list_backups", { token }),
  deleteBackup: (token: string, backupPath: string) =>
    invoke<void>("delete_backup", { token, backupPath }),
  exportDataArea: (token: string, area: DataArea, destination: string) =>
    invoke<DataAreaFile>("export_data_area", { token, area, destination }),
  inspectDataFile: (token: string, origin: string) =>
    invoke<DataArea>("inspect_data_file", { token, origin }),
  importDataArea: (token: string, origin: string) =>
    invoke<DataImportSummary>("import_data_area", { token, origin }),
  purgeDataArea: (token: string, area: DataArea, before: string) =>
    invoke<DataPurgeSummary>("purge_data_area", { token, area, before }),
  createBackup: (token: string) => invoke<BackupFile>("create_backup", { token }),
  listCreditVouchers: (token: string, search = "") =>
    invoke<LocalCreditVoucher[]>("list_credit_vouchers", { token, search }),
  withdrawCredit: (
    token: string,
    input: { voucher_item_id: string; quantity: number; client_withdrawal_id?: string },
  ) => invoke<LocalCreditVoucher>("withdraw_credit", { token, input }),
  printCreditVoucher: (token: string, saleId: string) =>
    invoke<boolean>("print_credit_voucher", { token, saleId }),
  reprintCreditVoucher: (token: string, voucherId: string) =>
    invoke<void>("reprint_credit_voucher", { token, voucherId }),
  cashSessionSales: (token: string, sessionId: string) =>
    invoke<LocalVendasDoTurno>("cash_session_sales", { token, sessionId }),
  exportTemplateSelection: (
    token: string,
    destination: string,
    selection: { produtos: boolean; cupom: boolean; papeis: boolean; usuarios: boolean },
  ) => invoke<string>("export_template_selection", { token, destination, selection }),

  listCashSessions: (token: string, range: ReportRange) =>
    invoke<CashSession[]>("list_cash_sessions", { token, range }),
  cashRollover: (token: string, reason: string) =>
    invoke<CashSession>("cash_rollover", { token, reason }),
  exportBackup: (token: string, destination: string) =>
    invoke<BackupFile>("export_backup", { token, destination }),
  restoreBackup: (token: string, backupPath: string) =>
    invoke<void>("restore_backup", { token, backupPath }),
};

/** Token da sessão local, para adaptadores fora da árvore React. */
export const DESKTOP_SESSION_KEY = "k7:desktop-session-token";
export function desktopToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(DESKTOP_SESSION_KEY);
}

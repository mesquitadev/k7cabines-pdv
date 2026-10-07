use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalUser {
    pub id: String,
    pub username: String,
    pub full_name: String,
    pub whatsapp: Option<String>,
    pub role: String,
    pub permissions: Vec<String>,
    /// Conta criada pelo master nasce com senha provisória e precisa trocá-la.
    pub must_change_password: bool,
}

#[derive(Debug, Serialize)]
pub struct SetupStatus {
    pub setup_completed: bool,
    /// O roteiro de configuração inicial (cupom, impressora, parâmetros,
    /// catálogo) já foi fechado pelo master.
    pub onboarding_completed: bool,
    pub installation_id: String,
    pub store_name: String,
    pub store_city: String,
}

#[derive(Debug, Deserialize)]
pub struct SetupInput {
    pub store_name: String,
    pub store_city: String,
    pub master_password: String,
}


#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordInput {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct Role {
    pub key: String,
    pub name: String,
    pub description: String,
    pub is_system: bool,
    pub is_master: bool,
    pub permissions: Vec<String>,
    /// Quantas contas ativas usam este papel. Zero é o que permite excluir.
    #[serde(default)]
    pub user_count: i64,
    /// Dias de histórico de vendas visíveis nos relatórios. 0 = sem limite.
    #[serde(default)]
    pub history_days: i64,
}

#[derive(Debug, Deserialize)]
pub struct RoleInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Conjunto completo de permissões do papel. O que não vier, sai.
    pub permissions: Vec<String>,
    /// Dias de histórico de vendas visíveis. 0 = sem limite.
    #[serde(default)]
    pub history_days: i64,
}

#[derive(Debug, Serialize)]
pub struct PermissionInfo {
    pub key: String,
    pub grupo: String,
    pub rotulo: String,
    pub descricao: String,
}


#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub token: String,
    pub user: LocalUser,
}

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub schema_version: i64,
    pub database_ready: bool,
    pub product_name: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct Product {
    pub id: String,
    pub code: String,
    pub name: String,
    pub category: String,
    pub subcategory: String,
    pub price_cents: i64,
    pub cost_cents: i64,
    pub barcode: Option<String>,
    pub min_stock: i64,
    pub stock_quantity: i64,
    pub category_id: Option<String>,
    /// Produto pai, quando este item é uma variação.
    pub parent_id: Option<String>,
    /// Nome da variação, como "50 ml" ou "12 unidades".
    pub variant_name: String,
    /// Um produto com variações agrupa e não é vendido diretamente.
    pub variant_count: i64,
    /// Unidade de medida: UN, CX, PC, PAR, ML ou G.
    pub unit: String,
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    /// Quando e por quanto este produto foi comprado pela última vez.
    pub last_purchase_at: Option<String>,
    pub last_purchase_cents: Option<i64>,
    /// Ligado no próprio produto: a venda pisca quando ele está no pedido.
    pub highlight: bool,
    /// Efetivo: o do produto OU o da categoria. É o que a venda usa.
    pub highlight_effective: bool,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProductInput {
    /// A venda pisca quando este produto está no pedido.
    #[serde(default)]
    pub highlight: bool,
    pub code: String,
    pub name: String,
    pub category: String,
    pub subcategory: Option<String>,
    pub price_cents: i64,
    #[serde(default)]
    pub cost_cents: i64,
    #[serde(default)]
    pub barcode: Option<String>,
    #[serde(default)]
    pub min_stock: i64,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub variant_name: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub supplier_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaleItemInput {
    pub product_id: String,
    pub quantity: i64,
    /// Item pago agora e retirado depois. Não baixa estoque na venda: a
    /// mercadoria continua na geladeira até o cliente vir buscar.
    #[serde(default)]
    pub credit: bool,
}

#[derive(Debug, Deserialize)]
pub struct FinalizeSaleInput {
    pub client_sale_id: String,
    pub items: Vec<SaleItemInput>,
    pub cash_tendered_cents: i64,
    pub card_cents: i64,
    #[serde(default)]
    pub pix_cents: i64,
    /// Desconto no total da venda, em centavos. Exige motivo por escrito.
    #[serde(default)]
    pub discount_cents: i64,
    /// Por que o desconto foi dado. Obrigatório quando há desconto; sai no fechamento.
    #[serde(default)]
    pub discount_reason: String,
    /// Nome do cliente, opcional. Sai no fechamento junto do desconto.
    #[serde(default)]
    pub customer_name: String,
    /// Como o cliente é chamado no balcão. Obrigatório quando há item em
    /// crédito: é por ele que a retirada é encontrada depois.
    #[serde(default)]
    pub credit_customer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletedSaleItem {
    pub product_id: String,
    pub product_code: String,
    pub product_name: String,
    pub category: String,
    pub unit_price_cents: i64,
    pub quantity: i64,
    pub subtotal_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletedSale {
    pub id: String,
    pub subtotal_cents: i64,
    pub discount_cents: i64,
    pub pix_cents: i64,
    pub client_sale_id: String,
    pub sale_number: i64,
    pub business_date: String,
    pub total_cents: i64,
    pub cash_tendered_cents: i64,
    pub card_cents: i64,
    pub change_cents: i64,
    pub operator_name: String,
    pub created_at: String,
    pub items: Vec<CompletedSaleItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProductBatch {
    pub id: String,
    pub product_id: String,
    pub expiry_date: String,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProductInput {
    #[serde(default)]
    pub highlight: bool,
    pub id: String,
    pub code: String,
    pub name: String,
    pub category: String,
    pub subcategory: Option<String>,
    pub price_cents: i64,
    #[serde(default)]
    pub cost_cents: i64,
    #[serde(default)]
    pub barcode: Option<String>,
    #[serde(default)]
    pub min_stock: i64,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub variant_name: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub supplier_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddStockInput {
    pub product_id: String,
    pub quantity: i64,
    pub expiry_date: Option<String>,
    /// Custo desta compra. Quando vem, recalcula o custo médio do produto.
    #[serde(default)]
    pub unit_cost_cents: Option<i64>,
    /// Nota livre do operador: nota fiscal, fornecedor, motivo.
    #[serde(default)]
    pub note: Option<String>,
    /// De quem se comprou. Guardado no movimento, não só no produto: o produto
    /// muda de fornecedor, a compra que já aconteceu não.
    #[serde(default)]
    pub supplier_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemoveStockInput {
    pub product_id: String,
    pub quantity: i64,
    /// Por que saiu: quebra, perda, uso interno. Fica no movimento.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketSettings {
    pub store_name: String,
    pub fiscal_label: String,
    pub footer_message: String,
    pub show_chapelaria: bool,
    pub chapelaria_label: String,
    pub show_datetime: bool,
    pub show_operator: bool,
    pub operator_label: String,
    pub pix_key: String,
    pub pix_merchant_name: String,
    pub pix_merchant_city: String,
    /// Razão social, quando diferente do nome fantasia.
    #[serde(default)]
    pub legal_name: String,
    /// CNPJ ou CPF, só com dígitos.
    #[serde(default)]
    pub document: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub address_line: String,
    #[serde(default)]
    pub district: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub zip: String,
    /// Linha livre do rodapé: Instagram, site, telefone de delivery.
    #[serde(default)]
    pub contact_line: String,
}

impl Default for TicketSettings {
    /// Os mesmos padrões da migration, para o cupom montar mesmo quando a
    /// configuração ainda não foi salva nenhuma vez.
    fn default() -> Self {
        Self {
            store_name: String::new(),
            fiscal_label: "NAO E DOCUMENTO FISCAL".into(),
            footer_message: "Obrigado pela preferencia".into(),
            show_chapelaria: true,
            chapelaria_label: "RETIRADA".into(),
            show_datetime: true,
            show_operator: true,
            operator_label: "Operador".into(),
            pix_key: String::new(),
            pix_merchant_name: String::new(),
            pix_merchant_city: String::new(),
            legal_name: String::new(),
            document: String::new(),
            phone: String::new(),
            address_line: String::new(),
            district: String::new(),
            city: String::new(),
            state: String::new(),
            zip: String::new(),
            contact_line: String::new(),
        }
    }
}

/// Configuração da impressora desta estação.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterSettings {
    pub printer_name: String,
    pub paper_width_mm: i64,
    pub columns: i64,
    pub copies: i64,
    pub feed_lines: i64,
    pub cut_paper: bool,
    pub open_drawer: bool,
    /// "escpos", "texto" ou "navegador".
    pub mode: String,
    pub codepage: i64,
    /// Imprimir o cupom sozinho ao emitir a venda.
    #[serde(default = "verdadeiro")]
    pub auto_print_sale: bool,
    /// Imprimir a ficha sozinha quando a venda deixa item para retirar.
    #[serde(default = "verdadeiro")]
    pub auto_print_credit: bool,
    /// Vias da ficha: uma para o cliente, outra para o balcão.
    #[serde(default = "uma")]
    pub credit_copies: i64,
}

fn verdadeiro() -> bool {
    true
}

fn uma() -> i64 {
    1
}

#[derive(Debug, Deserialize)]
pub struct ReportRange {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize)]
pub struct ReportSale {
    pub id: String,
    pub sale_number: i64,
    pub created_at: String,
    pub operator_name: String,
    pub items_count: i64,
    pub total_cents: i64,
    pub cash_cents: i64,
    pub card_cents: i64,
    pub discount_cents: i64,
    pub discount_reason: String,
    pub customer_name: String,
}

#[derive(Debug, Serialize)]
pub struct ReportItem {
    pub sale_id: String,
    pub category: String,
    /// Subcategoria do produto (vazia quando não há).
    pub subcategory: String,
    pub product_name: String,
    pub quantity: i64,
    pub subtotal_cents: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ReportMovement {
    pub id: String,
    pub product_name: String,
    pub delta: i64,
    pub reason: String,
    pub actor_name: String,
    pub occurred_at: String,
}

#[derive(Debug, Serialize)]
pub struct ReportDeletedSale {
    pub sale_number: i64,
    pub total_cents: i64,
    pub operator_name: String,
    pub deleted_by_name: String,
    pub reason: String,
    pub deleted_at: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteSaleInput {
    pub sale_id: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct ManagedUser {
    pub id: String,
    pub username: String,
    pub full_name: String,
    pub whatsapp: Option<String>,
    pub role: String,
    pub last_login_at: Option<String>,
    pub permissions: Vec<String>,
    /// Conta master permanente: indelével, não desativável, não rebaixável.
    pub is_permanent: bool,
    pub must_change_password: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserInput {
    pub username: String,
    pub password: String,
    pub full_name: String,
    pub whatsapp: Option<String>,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserInput {
    pub user_id: String,
    pub full_name: Option<String>,
    pub whatsapp: Option<String>,
    pub role: Option<String>,
    pub permissions: Option<std::collections::HashMap<String, bool>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupFile {
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CashSession {
    pub id: String,
    pub opened_at: String,
    pub opened_by_name: String,
    pub opening_float_cents: i64,
    pub closed_at: Option<String>,
    pub closed_by_name: Option<String>,
    pub expected_cash_cents: Option<i64>,
    pub counted_cash_cents: Option<i64>,
    pub difference_cents: Option<i64>,
    pub notes: Option<String>,
    pub status: String,
    /// Encerrado sem contar a gaveta, na virada de dia. Não tem diferença
    /// apurada: ninguém conferiu.
    #[serde(default)]
    pub closed_without_count: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CashSessionSummary {
    pub session_id: String,
    pub status: String,
    pub opening_float_cents: i64,
    pub cash_cents: i64,
    pub card_cents: i64,
    pub pix_cents: i64,
    pub total_sales_cents: i64,
    pub sales_count: i64,
    pub withdrawals_cents: i64,
    pub deposits_cents: i64,
    pub refunds_cash_cents: i64,
    pub esperado_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CashMovement {
    pub id: String,
    pub kind: String,
    pub amount_cents: i64,
    pub reason: String,
    pub actor_name: String,
    pub occurred_at: String,
}


#[derive(Debug, Deserialize)]
pub struct ReturnInput {
    /// Chave de idempotência: dois cliques no mesmo botão devolvem uma vez só.
    #[serde(default)]
    pub client_return_id: Option<String>,
    pub sale_item_id: String,
    pub quantity: i64,
    pub refund_kind: String,
    pub reason: String,
    pub restock: bool,
}

#[derive(Debug, Serialize)]
pub struct SaleItemForReturn {
    pub sale_item_id: String,
    pub product_name: String,
    pub quantity: i64,
    pub returned_quantity: i64,
    pub unit_price_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct InventoryCountInput {
    pub product_id: String,
    pub counted_quantity: i64,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct TemplateResumo {
    pub origem_loja: String,
    pub produtos_criados: i64,
    pub produtos_atualizados: i64,
    pub contas_criadas: i64,
    pub papeis_aplicados: i64,
}

#[derive(Debug, Serialize)]
pub struct SystemParam {
    pub key: String,
    pub value: String,
    pub tipo: String,
    pub grupo: String,
    pub rotulo: String,
    pub descricao: String,
    pub minimo: Option<i64>,
    pub maximo: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: String,
    pub sort_order: i64,
    pub active: bool,
    pub product_count: i64,
    /// Todos os produtos da categoria fazem a venda piscar.
    pub highlight: bool,
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: String,
    #[serde(default)]
    pub highlight: bool,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
pub struct Supplier {
    pub id: String,
    pub name: String,
    /// CNPJ ou CPF só com dígitos, quando informado.
    pub document: Option<String>,
    pub phone: String,
    pub email: String,
    pub notes: String,
    pub active: bool,
    /// Quantos produtos ativos apontam para este fornecedor.
    pub product_count: i64,
    pub last_purchase_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SupplierInput {
    pub name: String,
    #[serde(default)]
    pub document: Option<String>,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub notes: String,
}

/// Uma entrada de estoque vinda deste fornecedor.
#[derive(Debug, Serialize)]
pub struct SupplierPurchase {
    pub occurred_at: String,
    pub product_name: String,
    pub variant_name: String,
    pub quantity: i64,
    pub unit_cost_cents: Option<i64>,
    pub reason: String,
    pub actor_name: String,
}

/// Demonstrativo de resultado do período.
///
/// Não é um DRE contábil: a loja não tem contas a pagar nem despesas
/// lançadas, então para aqui no lucro bruto. O que existe é real — receita,
/// desconto, devolução e CMV saem de linhas gravadas, não de estimativa.
#[derive(Debug, Serialize)]
pub struct Dre {
    /// Soma dos itens vendidos, antes de desconto.
    pub receita_bruta_cents: i64,
    pub descontos_cents: i64,
    pub devolucoes_cents: i64,
    /// Bruta menos desconto e devolução.
    pub receita_liquida_cents: i64,
    /// Custo das mercadorias vendidas, pelo custo congelado na venda.
    pub cmv_cents: i64,
    pub lucro_bruto_cents: i64,
    /// Margem sobre a receita líquida, em pontos percentuais (12.34 = 12,34%).
    pub margem_percentual: f64,
    /// Itens vendidos sem custo gravado. Enquanto for maior que zero, o CMV
    /// está subestimado e a tela precisa dizer isso.
    pub itens_sem_custo: i64,
    pub itens_total: i64,
    pub vendas: i64,
    pub unidades: i64,
    pub ticket_medio_cents: i64,
    pub dinheiro_cents: i64,
    pub cartao_cents: i64,
    pub pix_cents: i64,
    pub troco_cents: i64,
    pub por_categoria: Vec<DreCategoria>,
    pub por_dia: Vec<DreDia>,
}

#[derive(Debug, Serialize)]
pub struct DreCategoria {
    pub categoria: String,
    pub receita_cents: i64,
    pub cmv_cents: i64,
    pub lucro_cents: i64,
    pub margem_percentual: f64,
    /// Fatia da receita do período, em pontos percentuais.
    pub participacao_percentual: f64,
    pub unidades: i64,
    pub itens_sem_custo: i64,
}

#[derive(Debug, Serialize)]
pub struct DreDia {
    pub dia: String,
    pub receita_cents: i64,
    pub cmv_cents: i64,
    pub lucro_cents: i64,
    pub vendas: i64,
}

/// Uma ficha em aberto: o que o cliente pagou e ainda não retirou.
#[derive(Debug, Serialize)]
pub struct CreditVoucher {
    pub id: String,
    pub sale_id: String,
    pub sale_number: i64,
    /// Código curto e único, impresso grande: é ele que identifica a ficha ao portador.
    pub code: String,
    /// Nome opcional (apelido de fila). Vazio na ficha ao portador.
    pub customer_name: String,
    pub created_at: String,
    pub settled_at: Option<String>,
    pub items: Vec<CreditVoucherItem>,
}

#[derive(Debug, Serialize)]
pub struct CreditVoucherItem {
    pub id: String,
    pub product_id: Option<String>,
    pub product_name: String,
    pub category: String,
    pub quantity: i64,
    pub taken_quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct WithdrawCreditInput {
    pub voucher_item_id: String,
    pub quantity: i64,
    #[serde(default)]
    pub client_withdrawal_id: Option<String>,
}

/// O que saiu no turno, do total para o item.
///
/// Existe para o fechamento responder "o que foi vendido hoje?" sem obrigar o
/// gerente a cruzar telas: categoria, subcategoria e produto na mesma leitura.
#[derive(Debug, Serialize)]
pub struct VendasDoTurno {
    pub total_cents: i64,
    pub unidades: i64,
    pub categorias: Vec<CategoriaVendida>,
}

#[derive(Debug, Serialize)]
pub struct CategoriaVendida {
    pub categoria: String,
    pub total_cents: i64,
    pub unidades: i64,
    pub subcategorias: Vec<SubcategoriaVendida>,
}

#[derive(Debug, Serialize)]
pub struct SubcategoriaVendida {
    /// Vazio quando o produto não tem subcategoria.
    pub subcategoria: String,
    pub total_cents: i64,
    pub unidades: i64,
    pub produtos: Vec<ProdutoVendido>,
}

#[derive(Debug, Serialize)]
pub struct ProdutoVendido {
    pub produto: String,
    pub unidades: i64,
    pub total_cents: i64,
}

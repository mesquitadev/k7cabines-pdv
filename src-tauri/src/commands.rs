use tauri::State;

use std::path::Path;

use crate::{
    auth, backup, dados,
    db::LATEST_SCHEMA_VERSION,
    models::{
        AddStockInput, AppInfo, BackupFile, CashMovement, CashSession, Category, CategoryInput,
        CashSessionSummary, ChangePasswordInput, CompletedSale, CreateProductInput,
        DeleteSaleInput, Dre, FinalizeSaleInput, LocalUser, LoginInput, Product,
        CreateUserInput, ManagedUser, ProductBatch, RemoveStockInput, ReportDeletedSale,
        ReportItem, ReportMovement, ReportRange, ReportSale, SessionResponse, TicketSettings,
        InventoryCountInput, PermissionInfo, ReturnInput, Role, SaleItemForReturn, SetupInput,
        CreditVoucher, PrinterSettings, RoleInput, SetupStatus, Supplier, SupplierInput, SupplierPurchase, SystemParam, TemplateResumo,
        UpdateProductInput, UpdateUserInput, VendasDoTurno, WithdrawCreditInput,
    },
    cash, categories, credito, params, printing, products, reports, returns, sales, settings, setup,
    stock,
    suppliers,
    template, users,
    state::AppState,
};

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        schema_version: LATEST_SCHEMA_VERSION,
        database_ready: true,
        product_name: "K7Cabines | PDV",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
pub fn setup_status(state: State<'_, AppState>) -> Result<SetupStatus, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    setup::status(&database).map_err(Into::into)
}

#[tauri::command]
pub fn set_onboarding(
    completed: bool,
    token: String,
    state: State<'_, AppState>,
) -> Result<SetupStatus, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    setup::set_onboarding(&database, &actor, completed).map_err(Into::into)
}

#[tauri::command]
pub fn complete_setup(
    input: SetupInput,
    state: State<'_, AppState>,
) -> Result<SessionResponse, String> {
    let user = {
        let mut database = state
            .database
            .lock()
            .map_err(|_| "banco local indisponível".to_string())?;
        setup::complete(&mut database, input, env!("CARGO_PKG_VERSION")).map_err(String::from)?
    };
    let token = {
        let database = state
            .database
            .lock()
            .map_err(|_| "banco local indisponível".to_string())?;
        state.create_session(user.clone(), &database).map_err(String::from)?
    };
    Ok(SessionResponse { token, user })
}

#[tauri::command]
pub fn login(input: LoginInput, state: State<'_, AppState>) -> Result<SessionResponse, String> {
    let user = {
        let database = state
            .database
            .lock()
            .map_err(|_| "banco local indisponível".to_string())?;
        let user =
            auth::authenticate(&database, &input.username, &input.password).map_err(String::from)?;
        // Último acesso, exibido na tela de usuários.
        auth::touch_last_login(&database, &user.id).map_err(String::from)?;
        user
    };
    let token = {
        let database = state
            .database
            .lock()
            .map_err(|_| "banco local indisponível".to_string())?;
        state.create_session(user.clone(), &database).map_err(String::from)?
    };
    Ok(SessionResponse { token, user })
}

/// Retoma a sessão guardada, para que reabrir o aplicativo não derrube
/// o operador no meio do turno.
#[tauri::command]
pub fn current_session(token: String, state: State<'_, AppState>) -> Result<LocalUser, String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    state.resume_session(&token, &database).map_err(Into::into)
}

#[tauri::command]
pub fn logout(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    state.remove_session(&token, &database).map_err(Into::into)
}

#[tauri::command]
pub fn list_products(token: String, state: State<'_, AppState>) -> Result<Vec<Product>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    products::list(&database).map_err(Into::into)
}

#[tauri::command]
pub fn create_product(
    input: CreateProductInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Product, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    products::create(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn finalize_sale(
    input: FinalizeSaleInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<CompletedSale, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    sales::finalize(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn sale_by_client_id(
    client_sale_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<Option<CompletedSale>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    sales::find_by_client_sale_id(&database, &client_sale_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_batches(token: String, state: State<'_, AppState>) -> Result<Vec<ProductBatch>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    stock::list_batches(&database).map_err(Into::into)
}

#[tauri::command]
pub fn update_product(
    input: UpdateProductInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Product, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    stock::update_product(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn delete_product(
    product_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    stock::delete_product(&mut database, &actor, &product_id).map_err(Into::into)
}

#[tauri::command]
pub fn add_stock(
    input: AddStockInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    stock::add_stock(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn remove_stock(
    input: RemoveStockInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    stock::remove_stock(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn delete_batch(
    batch_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    stock::delete_batch(&mut database, &actor, &batch_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_ticket_settings(
    token: String,
    state: State<'_, AppState>,
) -> Result<TicketSettings, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    settings::get(&database).map_err(Into::into)
}

#[tauri::command]
pub fn save_ticket_settings(
    input: TicketSettings,
    token: String,
    state: State<'_, AppState>,
) -> Result<TicketSettings, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    settings::save(&mut database, &actor, input).map_err(Into::into)
}

macro_rules! relatorio {
    ($nome:ident, $fn:path, $saida:ty) => {
        #[tauri::command]
        pub fn $nome(
            range: ReportRange,
            token: String,
            state: State<'_, AppState>,
        ) -> Result<Vec<$saida>, String> {
            let actor = state.user_for(&token).map_err(String::from)?;
            let database = state
                .database
                .lock()
                .map_err(|_| "banco local indisponível".to_string())?;
            $fn(&database, &actor, range).map_err(Into::into)
        }
    };
}

/// Primeira data que o usuário logado pode consultar nos relatórios
/// (`null` = sem limite). A tela usa para travar o campo "De".
#[tauri::command]
pub fn report_earliest_date(token: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    reports::earliest_allowed(&database, &actor)
        .map(|d| d.map(|d| d.to_string()))
        .map_err(Into::into)
}

relatorio!(report_sales, reports::sales, ReportSale);
relatorio!(report_items, reports::items, ReportItem);
relatorio!(report_movements, reports::movements, ReportMovement);
relatorio!(report_deleted_sales, reports::deleted_sales, ReportDeletedSale);

#[tauri::command]
pub fn delete_sale(
    input: DeleteSaleInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    reports::delete_sale(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn list_users(token: String, state: State<'_, AppState>) -> Result<Vec<ManagedUser>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::list(&database, &actor).map_err(Into::into)
}

#[tauri::command]
pub fn create_user(
    input: CreateUserInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<ManagedUser, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::create(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn update_user(
    input: UpdateUserInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<ManagedUser, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let alvo = input.user_id.clone();
    let atualizado = users::update(&mut database, &actor, input)?;
    // A autorização de quem já está logado vive na memória; sem derrubar a
    // sessão, tirar uma permissão só valeria no próximo acesso.
    state.revogar_usuario(&alvo);
    Ok(atualizado)
}

#[tauri::command]
pub fn set_user_password(
    user_id: String,
    password: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::set_password(&mut database, &actor, &user_id, &password).map_err(Into::into)
}

#[tauri::command]
pub fn delete_user(
    user_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::delete(&mut database, &actor, &user_id)?;
    state.revogar_usuario(&user_id);
    Ok(())
}

#[tauri::command]
pub fn list_backups(token: String, state: State<'_, AppState>) -> Result<Vec<BackupFile>, String> {
    state.user_for(&token).map_err(String::from)?;
    backup::list(&state.app_data).map_err(Into::into)
}

#[tauri::command]
pub fn create_backup(token: String, state: State<'_, AppState>) -> Result<BackupFile, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    backup::create_manual(&database, &actor, &state.app_data).map_err(Into::into)
}

/// Substitui o banco ativo. A conexão em uso é fechada e reaberta aqui dentro;
/// se algo falhar, o banco original é reaberto antes de devolver o erro.
#[tauri::command]
pub fn restore_backup(
    backup_path: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    if !actor.permissions.iter().any(|p| p == "backup.manage") {
        return Err("operação não permitida".to_string());
    }

    let alvo = Path::new(&backup_path).to_path_buf();
    backup::validate(&alvo).map_err(String::from)?;

    let mut guard = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;

    let provisoria = rusqlite::Connection::open_in_memory()
        .map_err(|_| "não foi possível preparar a restauração".to_string())?;
    let atual = std::mem::replace(&mut *guard, provisoria);

    match backup::restore(atual, &state.db_path, &state.app_data, &alvo) {
        Ok(nova) => {
            *guard = nova;
            Ok(())
        }
        Err(error) => {
            // Recoloca o banco original para o app continuar utilizável.
            match crate::db::open(&state.db_path) {
                Ok(reaberta) => *guard = reaberta,
                Err(falha) => {
                    return Err(format!(
                        "restauração falhou ({error}) e o banco não pôde ser reaberto: {falha}"
                    ))
                }
            }
            Err(error.into())
        }
    }
}

#[tauri::command]
pub fn change_own_password(
    input: ChangePasswordInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Sem exigir a troca: é justamente o comando que a realiza.
    let actor = state.sessao_bruta(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    auth::change_own_password(
        &mut database,
        &actor.id,
        &input.current_password,
        &input.new_password,
    )
    .map_err(String::from)?;
    // A sessão em memória precisa refletir que a senha já foi trocada.
    state.refresh_session(&token, &database).map_err(Into::into)
}

#[tauri::command]
pub fn list_roles(token: String, state: State<'_, AppState>) -> Result<Vec<Role>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::list_roles(&database).map_err(Into::into)
}

#[tauri::command]
pub fn list_permissions(
    token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PermissionInfo>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::list_permissions(&database).map_err(Into::into)
}

#[tauri::command]
pub fn cash_open_session(token: String, state: State<'_, AppState>) -> Result<Option<CashSession>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::sessao_aberta(&database).map_err(Into::into)
}

#[tauri::command]
pub fn cash_open(
    opening_float_cents: i64,
    token: String,
    state: State<'_, AppState>,
) -> Result<CashSession, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::abrir(&mut database, &actor, opening_float_cents).map_err(Into::into)
}

#[tauri::command]
pub fn cash_move(
    kind: String,
    amount_cents: i64,
    reason: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<CashSession, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::movimentar(&mut database, &actor, &kind, amount_cents, &reason).map_err(Into::into)
}

#[tauri::command]
pub fn cash_summary(
    session_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<CashSessionSummary, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::resumo(&database, &session_id).map_err(Into::into)
}

#[tauri::command]
pub fn cash_movements(
    session_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CashMovement>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::movimentos(&database, &session_id).map_err(Into::into)
}

#[tauri::command]
pub fn cash_close(
    counted_cents: i64,
    notes: Option<String>,
    token: String,
    state: State<'_, AppState>,
) -> Result<CashSession, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::fechar(&mut database, &actor, counted_cents, notes).map_err(Into::into)
}

#[tauri::command]
pub fn sale_items_for_return(
    sale_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SaleItemForReturn>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    returns::itens_da_venda(&database, &actor, &sale_id).map_err(Into::into)
}

#[tauri::command]
pub fn return_sale_item(
    input: ReturnInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    returns::devolver(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn inventory_count(
    input: InventoryCountInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    returns::contar(&mut database, &actor, input).map_err(Into::into)
}

/// Exporta o que é comum a todas as lojas: catálogo, cupom, papéis e contas.
/// Venda, caixa, estoque e lote ficam de fora — são a operação desta loja.
#[tauri::command]
pub fn export_template(
    destino: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let caminho = Path::new(&destino).to_path_buf();
    template::exportar(&database, &actor, &caminho).map_err(String::from)?;
    Ok(caminho.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_template(
    origem: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<TemplateResumo, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    template::importar(&mut database, &actor, Path::new(&origem)).map_err(Into::into)
}

#[tauri::command]
pub fn list_params(token: String, state: State<'_, AppState>) -> Result<Vec<SystemParam>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    params::listar(&database).map_err(Into::into)
}

#[tauri::command]
pub fn set_param(
    key: String,
    value: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    params::definir(&mut database, &actor, &key, &value).map_err(Into::into)
}

#[tauri::command]
pub fn list_categories(token: String, state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    categories::listar(&database).map_err(Into::into)
}

#[tauri::command]
pub fn create_category(
    input: CategoryInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Category, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    categories::criar(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn update_category(
    id: String,
    input: CategoryInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Category, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    categories::atualizar(&mut database, &actor, &id, input).map_err(Into::into)
}

#[tauri::command]
pub fn deactivate_category(
    id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    categories::desativar(&mut database, &actor, &id).map_err(Into::into)
}

#[tauri::command]
pub fn list_suppliers(token: String, state: State<'_, AppState>) -> Result<Vec<Supplier>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    suppliers::listar(&database, &actor).map_err(Into::into)
}

#[tauri::command]
pub fn create_supplier(
    input: SupplierInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Supplier, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    suppliers::criar(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn update_supplier(
    supplier_id: String,
    input: SupplierInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Supplier, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    suppliers::atualizar(&mut database, &actor, &supplier_id, input).map_err(Into::into)
}

#[tauri::command]
pub fn deactivate_supplier(
    supplier_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    suppliers::desativar(&mut database, &actor, &supplier_id).map_err(Into::into)
}

#[tauri::command]
pub fn reactivate_supplier(
    supplier_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    suppliers::reativar(&mut database, &actor, &supplier_id).map_err(Into::into)
}

#[tauri::command]
pub fn supplier_purchases(
    supplier_id: String,
    limit: i64,
    token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SupplierPurchase>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    suppliers::compras(&database, &actor, &supplier_id, limit).map_err(Into::into)
}

#[tauri::command]
pub fn create_role(
    input: RoleInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Role, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::create_role(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn update_role(
    role_key: String,
    input: RoleInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<Role, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let papel = users::update_role(&mut database, &actor, &role_key, input)?;
    // Quem está logado com este papel precisa ver a mudança sem sair e entrar.
    let _ = state.refresh_session(&token, &database);
    Ok(papel)
}

#[tauri::command]
pub fn delete_role(
    role_key: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    users::delete_role(&mut database, &actor, &role_key).map_err(Into::into)
}

#[tauri::command]
pub fn list_system_printers(token: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    printing::listar(&actor).map_err(Into::into)
}

#[tauri::command]
pub fn get_printer_settings(
    token: String,
    state: State<'_, AppState>,
) -> Result<PrinterSettings, String> {
    state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    printing::obter_config(&database).map_err(Into::into)
}

#[tauri::command]
pub fn save_printer_settings(
    input: PrinterSettings,
    token: String,
    state: State<'_, AppState>,
) -> Result<PrinterSettings, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    printing::salvar_config(&database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn print_test_page(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    printing::imprimir_teste(&database, &actor).map_err(Into::into)
}

#[tauri::command]
pub fn print_sale_receipt(
    sale_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    printing::imprimir_cupom_por_id(&database, &actor, &sale_id).map_err(Into::into)
}

#[tauri::command]
pub fn open_cash_drawer(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    printing::abrir_gaveta(&database, &actor).map_err(Into::into)
}

#[tauri::command]
pub fn delete_category(
    category_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    categories::excluir(&mut database, &actor, &category_id).map_err(Into::into)
}

#[tauri::command]
pub fn report_dre(
    range: ReportRange,
    token: String,
    state: State<'_, AppState>,
) -> Result<Dre, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    reports::dre(&database, &actor, range).map_err(Into::into)
}

#[tauri::command]
pub fn export_backup(
    destination: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<BackupFile, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    if !actor.permissions.iter().any(|p| p == "backup.manage") {
        return Err("operação não permitida".into());
    }
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    backup::exportar(&database, std::path::Path::new(&destination)).map_err(Into::into)
}

#[tauri::command]
pub fn cash_rollover(
    reason: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<CashSession, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::virar_dia(&mut database, &actor, &reason).map_err(Into::into)
}

#[tauri::command]
pub fn list_cash_sessions(
    range: ReportRange,
    token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CashSession>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::listar(&database, &actor, &range.from, &range.to).map_err(Into::into)
}

#[tauri::command]
pub fn list_credit_vouchers(
    search: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CreditVoucher>, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    credito::listar_abertas(&database, &actor, &search).map_err(Into::into)
}

#[tauri::command]
pub fn withdraw_credit(
    input: WithdrawCreditInput,
    token: String,
    state: State<'_, AppState>,
) -> Result<CreditVoucher, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    credito::retirar(&mut database, &actor, input).map_err(Into::into)
}

#[tauri::command]
pub fn cash_session_sales(
    session_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<VendasDoTurno, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    cash::vendas_do_turno(&database, &actor, &session_id).map_err(Into::into)
}

#[tauri::command]
pub fn export_template_selection(
    destination: String,
    selection: template::Selecao,
    token: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    template::exportar_selecao(&database, &actor, std::path::Path::new(&destination), selection)?;
    Ok(destination)
}

/// Imprime a ficha de uma venda, se ela tiver criado uma.
///
/// A tela manda só o id da venda: como no cupom, o Rust relê do banco para o
/// papel não poder dizer coisa diferente do que está gravado.
#[tauri::command]
pub fn print_credit_voucher(
    sale_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let Some(ficha) = credito::da_venda(&database, &sale_id)? else {
        return Ok(false);
    };
    printing::imprimir_ficha(&database, &actor, &ficha)?;
    Ok(true)
}

/// Reimprime a ficha pelo id, a partir da lista de fichas em aberto.
#[tauri::command]
pub fn reprint_credit_voucher(
    voucher_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let ficha = credito::por_id(&database, &actor, &voucher_id)?;
    printing::imprimir_ficha(&database, &actor, &ficha).map_err(Into::into)
}

#[tauri::command]
pub fn clear_user_exceptions(
    user_id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<ManagedUser, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let atualizado = users::limpar_excecoes(&mut database, &actor, &user_id)?;
    state.revogar_usuario(&user_id);
    Ok(atualizado)
}


// ============================================================
// Dados por área: exportar, importar, limpar; apagar backup.
// ============================================================

#[tauri::command]
pub fn delete_backup(
    backup_path: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    dados::apagar_backup(&actor, &state.app_data, Path::new(&backup_path)).map_err(Into::into)
}

#[tauri::command]
pub fn export_data_area(
    area: dados::Area,
    destination: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<dados::ArquivoArea, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    dados::exportar(&database, &actor, area, Path::new(&destination)).map_err(Into::into)
}

#[tauri::command]
pub fn inspect_data_file(origin: String, token: String, state: State<'_, AppState>) -> Result<dados::Area, String> {
    state.user_for(&token).map_err(String::from)?;
    dados::inspecionar(Path::new(&origin)).map_err(Into::into)
}

#[tauri::command]
pub fn import_data_area(
    origin: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<dados::ResumoImportacao, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    dados::importar(&mut database, &actor, Path::new(&origin)).map_err(Into::into)
}

#[tauri::command]
pub fn purge_data_area(
    area: dados::Area,
    before: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<dados::ResumoLimpeza, String> {
    let actor = state.user_for(&token).map_err(String::from)?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    dados::limpar(&mut database, &actor, area, &before, &state.app_data).map_err(Into::into)
}

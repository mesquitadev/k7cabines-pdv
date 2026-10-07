mod auth;
mod backup;
mod cash;
mod categories;
mod credito;
mod commands;
mod dados;
mod db;
mod error;
mod escpos;
mod identificacao;
mod models;
mod params;
mod printing;
mod products;
mod reports;
mod returns;
mod sales;
mod settings;
mod setup;
mod state;
mod stock;
mod suppliers;
mod template;
mod users;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Seletor de arquivo nativo: exportar o modelo é escolher onde salvar,
        // não digitar um caminho de cabeça.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("k7-cabines.sqlite3");
            let database = db::open(&db_path)
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;

            // Backup automático diário: falhar aqui não pode impedir o caixa de abrir.
            if let Err(error) = backup::run_automatic(&database, &app_data) {
                eprintln!("backup automático não executado: {error}");
            }

            app.manage(AppState::new(database, app_data, db_path));

            // No macOS o binário de desenvolvimento roda fora de um .app; sem política
            // de ativação regular a janela pode nunca virar key window e, com isso,
            // não recebe eventos de teclado. Não envolve o event loop.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::setup_status,
            commands::complete_setup,
            commands::set_onboarding,
            commands::login,
            commands::current_session,
            commands::logout,
            commands::list_products,
            commands::create_product,
            commands::finalize_sale,
            commands::sale_by_client_id,
            commands::list_batches,
            commands::update_product,
            commands::delete_product,
            commands::add_stock,
            commands::remove_stock,
            commands::delete_batch,
            commands::get_ticket_settings,
            commands::save_ticket_settings,
            commands::report_sales,
            commands::report_items,
            commands::report_movements,
            commands::report_deleted_sales,
            commands::delete_sale,
            commands::list_users,
            commands::create_user,
            commands::update_user,
            commands::set_user_password,
            commands::delete_user,
            commands::change_own_password,
            commands::list_roles,
            commands::list_permissions,
            commands::cash_open_session,
            commands::cash_open,
            commands::cash_move,
            commands::cash_summary,
            commands::cash_movements,
            commands::cash_close,
            commands::sale_items_for_return,
            commands::return_sale_item,
            commands::inventory_count,
            commands::export_template,
            commands::import_template,
            commands::list_params,
            commands::set_param,
            commands::list_categories,
            commands::delete_category,
            commands::report_dre,
            commands::report_earliest_date,
            commands::export_backup,
            commands::cash_rollover,
            commands::list_cash_sessions,
            commands::cash_session_sales,
            commands::list_credit_vouchers,
            commands::withdraw_credit,
            commands::print_credit_voucher,
            commands::reprint_credit_voucher,
            commands::export_template_selection,
            commands::list_system_printers,
            commands::get_printer_settings,
            commands::save_printer_settings,
            commands::print_test_page,
            commands::print_sale_receipt,
            commands::open_cash_drawer,
            commands::clear_user_exceptions,
            commands::create_role,
            commands::update_role,
            commands::delete_role,
            commands::list_suppliers,
            commands::create_supplier,
            commands::update_supplier,
            commands::deactivate_supplier,
            commands::reactivate_supplier,
            commands::supplier_purchases,
            commands::create_category,
            commands::update_category,
            commands::deactivate_category,
            commands::list_backups,
            commands::create_backup,
            commands::restore_backup,
            commands::delete_backup,
            commands::export_data_area,
            commands::inspect_data_file,
            commands::import_data_area,
            commands::purge_data_area,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o K7 Cabines");
}

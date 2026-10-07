use chrono::Utc;
use rusqlite::{params, Connection};

use crate::{
    error::{AppError, AppResult},
    models::{LocalUser, TicketSettings},
};

const MAX_TEXT: usize = 200;

pub fn get(connection: &Connection) -> AppResult<TicketSettings> {
    connection
        .query_row(
            "SELECT store_name, fiscal_label, footer_message, show_chapelaria, chapelaria_label,
                    show_datetime, show_operator, operator_label,
                    pix_key, pix_merchant_name, pix_merchant_city,
                    legal_name, document, phone, address_line, district, city, state, zip,
                    contact_line
             FROM ticket_settings WHERE id = 1",
            [],
            |row| {
                Ok(TicketSettings {
                    store_name: row.get(0)?,
                    fiscal_label: row.get(1)?,
                    footer_message: row.get(2)?,
                    show_chapelaria: row.get(3)?,
                    chapelaria_label: row.get(4)?,
                    show_datetime: row.get(5)?,
                    show_operator: row.get(6)?,
                    operator_label: row.get(7)?,
                    pix_key: row.get(8)?,
                    pix_merchant_name: row.get(9)?,
                    pix_merchant_city: row.get(10)?,
                    legal_name: row.get(11)?,
                    document: row.get(12)?,
                    phone: row.get(13)?,
                    address_line: row.get(14)?,
                    district: row.get(15)?,
                    city: row.get(16)?,
                    state: row.get(17)?,
                    zip: row.get(18)?,
                    contact_line: row.get(19)?,
                })
            },
        )
        .map_err(Into::into)
}

pub fn save(
    connection: &mut Connection,
    actor: &LocalUser,
    input: TicketSettings,
) -> AppResult<TicketSettings> {
    if !actor.permissions.iter().any(|p| p == "printer.manage") {
        return Err(AppError::Forbidden);
    }
    for campo in [
        &input.store_name,
        &input.fiscal_label,
        &input.footer_message,
        &input.chapelaria_label,
        &input.operator_label,
        &input.pix_key,
        &input.pix_merchant_name,
        &input.pix_merchant_city,
        &input.legal_name,
        &input.address_line,
        &input.district,
        &input.city,
        &input.contact_line,
    ] {
        if campo.chars().count() > MAX_TEXT {
            return Err(AppError::Validation(
                "texto do ticket é longo demais".into(),
            ));
        }
    }

    // CNPJ/CPF passa pelo mesmo dígito verificador do fornecedor: um documento
    // errado no cupom é pior que nenhum.
    let documento = crate::suppliers::normaliza_documento(Some(&input.document))?
        .unwrap_or_default();
    let uf = input.state.trim().to_uppercase();
    if !uf.is_empty() && uf.chars().count() != 2 {
        return Err(AppError::Validation("UF deve ter duas letras".into()));
    }
    let cep: String = input.zip.chars().filter(char::is_ascii_digit).collect();
    if !cep.is_empty() && cep.len() != 8 {
        return Err(AppError::Validation("CEP deve ter 8 dígitos".into()));
    }

    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE ticket_settings
         SET store_name = ?1, fiscal_label = ?2, footer_message = ?3, show_chapelaria = ?4,
             chapelaria_label = ?5, show_datetime = ?6, show_operator = ?7, operator_label = ?8,
             pix_key = ?9, pix_merchant_name = ?10, pix_merchant_city = ?11,
             legal_name = ?12, document = ?13, phone = ?14, address_line = ?15,
             district = ?16, city = ?17, state = ?18, zip = ?19, contact_line = ?20,
             updated_at = ?21, updated_by = ?22
         WHERE id = 1",
        params![
            input.store_name,
            input.fiscal_label,
            input.footer_message,
            input.show_chapelaria,
            input.chapelaria_label,
            input.show_datetime,
            input.show_operator,
            input.operator_label,
            input.pix_key.trim(),
            input.pix_merchant_name.trim(),
            input.pix_merchant_city.trim(),
            input.legal_name.trim(),
            documento,
            input.phone.trim(),
            input.address_line.trim(),
            input.district.trim(),
            input.city.trim(),
            uf,
            cep,
            input.contact_line.trim(),
            now,
            actor.id
        ],
    )?;
    get(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn gerente() -> LocalUser {
        LocalUser {
            id: "g1".into(),
            username: "g".into(),
            full_name: "Gerente".into(),
            whatsapp: None,
            role: "gerente".into(),
            permissions: vec!["printer.manage".into()],
        must_change_password: false,
        }
    }

    fn com_gerente() -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at)
             VALUES ('g1', 'g', 'x', 'Gerente', 'gerente', 1, 'now', 'now')",
            [],
        ).unwrap();
        c
    }

    #[test]
    fn salva_e_le_configuracoes_do_ticket() {
        let mut c = com_gerente();
        let atual = get(&c).unwrap();
        assert!(atual.show_chapelaria, "chapelaria vem ligada por padrão");

        let salvo = save(
            &mut c,
            &gerente(),
            TicketSettings {
                store_name: "Sex Shop K7 Cabines - Pavuna".into(),
                fiscal_label: "CUPOM NÃO FISCAL".into(),
                footer_message: "Até a próxima!".into(),
                show_chapelaria: true,
                chapelaria_label: "CHAPELARIA Nº".into(),
                show_datetime: true,
                show_operator: false,
                operator_label: "Operador".into(),
                pix_key: "".into(),
                pix_merchant_name: "".into(),
                pix_merchant_city: "".into(),
                legal_name: "K7 Comercio LTDA".into(),
                document: "11.222.333/0001-81".into(),
                phone: "(21) 98888-7777".into(),
                address_line: "Rua das Flores, 100".into(),
                district: "Pavuna".into(),
                city: "Rio de Janeiro".into(),
                state: "rj".into(),
                zip: "21000-000".into(),
                contact_line: "@k7cabines".into(),
            },
        )
        .unwrap();
        assert_eq!(salvo.store_name, "Sex Shop K7 Cabines - Pavuna");
        // Documento entra pontuado e é guardado só com dígitos, validado.
        assert_eq!(salvo.document, "11222333000181");
        assert_eq!(salvo.state, "RJ", "UF é normalizada em maiúsculas");
        assert_eq!(salvo.zip, "21000000", "CEP guarda só os dígitos");
        assert!(!salvo.show_operator);
        assert_eq!(get(&c).unwrap().chapelaria_label, "CHAPELARIA Nº");
    }

    #[test]
    fn exige_permissao_de_impressora() {
        let mut c = com_gerente();
        let mut sem = gerente();
        sem.permissions.clear();
        let atual = get(&c).unwrap();
        let r = save(&mut c, &sem, atual);
        assert!(matches!(r, Err(AppError::Forbidden)));
    }
}

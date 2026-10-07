//! Impressão pelo sistema operacional, sem passar pelo diálogo do WebView.
//!
//! O legado usava `window.print()`, que abre a caixa de diálogo do sistema: uma
//! confirmação por cupom, com a fila esperando, e sem forma de cortar o papel
//! ou abrir a gaveta. Aqui o cupom vira bytes ESC/POS e vai direto para a fila
//! da impressora escolhida.

#[cfg(not(target_os = "windows"))]
use std::io::Write;
use std::process::Command;
#[cfg(not(target_os = "windows"))]
use std::process::Stdio;

use chrono::Utc;
use rusqlite::{params, Connection};

use crate::{
    error::{AppError, AppResult},
    escpos::{Alinhamento, Cupom},
    models::{CompletedSale, CreditVoucher, LocalUser, PrinterSettings, TicketSettings},
};

/// CNPJ ou CPF com pontuação, para leitura no papel.
fn formatar_documento(digitos: &str) -> String {
    let d: Vec<char> = digitos.chars().filter(char::is_ascii_digit).collect();
    let pedaco = |de: usize, ate: usize| d[de..ate].iter().collect::<String>();
    match d.len() {
        // 00.000.000/0000-00
        14 => format!(
            "CNPJ {}.{}.{}/{}-{}",
            pedaco(0, 2),
            pedaco(2, 5),
            pedaco(5, 8),
            pedaco(8, 12),
            pedaco(12, 14)
        ),
        // 000.000.000-00
        11 => format!(
            "CPF {}.{}.{}-{}",
            pedaco(0, 3),
            pedaco(3, 6),
            pedaco(6, 9),
            pedaco(9, 11)
        ),
        _ => digitos.to_string(),
    }
}

fn require(actor: &LocalUser, permission: &str) -> AppResult<()> {
    if actor.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Impede que um nome vindo da tela vire argumento perigoso de linha de comando.
///
/// O nome nunca passa por shell — `Command` recebe argumentos separados — mas um
/// nome com quebra de linha ou barra confunde o `lp` e o spooler do Windows.
fn nome_seguro(nome: &str) -> AppResult<&str> {
    let limpo = nome.trim();
    if limpo.is_empty() {
        return Err(AppError::Validation("nenhuma impressora escolhida".into()));
    }
    if limpo.chars().count() > 120 {
        return Err(AppError::Validation("nome de impressora inválido".into()));
    }
    // Allowlist, não lista negra. No Windows o nome vira argumento de `cmd`, e
    // `&`, `|`, `^` e `>` fazem o shell executar outra coisa: um nome como
    // "HP&calc.exe" transformaria toda impressão de cupom em execução de
    // programa. Lista negra sempre esquece um caractere; a allowlist não.
    if !limpo
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')' | '#' | '@'))
    {
        return Err(AppError::Validation(
            "o nome da impressora tem caractere não permitido; use letras, números, espaço, hífen, ponto e sublinhado".into(),
        ));
    }
    Ok(limpo)
}

/// Lista as impressoras instaladas na máquina.
///
/// Cada sistema tem o seu jeito e nenhum tem biblioteca embutida no Rust que
/// cubra os três, então cada um usa a ferramenta que já vem instalada.
pub fn listar(actor: &LocalUser) -> AppResult<Vec<String>> {
    require(actor, "printer.configure")?;

    #[cfg(target_os = "windows")]
    let saida = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Printer | Select-Object -ExpandProperty Name",
        ])
        .output();

    #[cfg(not(target_os = "windows"))]
    // `lpstat -e` lista os destinos do CUPS, inclusive os não configurados como
    // padrão. É o que existe tanto no macOS quanto nas distribuições Linux.
    let saida = Command::new("lpstat").arg("-e").output();

    match saida {
        Ok(resultado) => {
            let texto = String::from_utf8_lossy(&resultado.stdout);
            Ok(texto
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(str::to_string)
                .collect())
        }
        // Sem CUPS ou sem PowerShell não é erro: a estação pode não ter
        // impressora ainda, e a tela precisa abrir para o usuário configurar.
        Err(_) => Ok(Vec::new()),
    }
}

pub fn obter_config(connection: &Connection) -> AppResult<PrinterSettings> {
    connection
        .query_row(
            "SELECT printer_name, paper_width_mm, columns, copies, feed_lines,
                    cut_paper, open_drawer, mode, codepage,
                    auto_print_sale, auto_print_credit, credit_copies
             FROM printer_settings WHERE id = 1",
            [],
            |row| {
                Ok(PrinterSettings {
                    printer_name: row.get(0)?,
                    paper_width_mm: row.get(1)?,
                    columns: row.get(2)?,
                    copies: row.get(3)?,
                    feed_lines: row.get(4)?,
                    cut_paper: row.get(5)?,
                    open_drawer: row.get(6)?,
                    mode: row.get(7)?,
                    codepage: row.get(8)?,
                    auto_print_sale: row.get(9)?,
                    auto_print_credit: row.get(10)?,
                    credit_copies: row.get(11)?,
                })
            },
        )
        .map_err(Into::into)
}

pub fn salvar_config(
    connection: &Connection,
    actor: &LocalUser,
    entrada: PrinterSettings,
) -> AppResult<PrinterSettings> {
    require(actor, "printer.configure")?;
    if !matches!(entrada.paper_width_mm, 58 | 80) {
        return Err(AppError::Validation("largura do papel deve ser 58 ou 80 mm".into()));
    }
    if !(24..=64).contains(&entrada.columns) {
        return Err(AppError::Validation(
            "colunas fora da faixa: use entre 24 e 64".into(),
        ));
    }
    if !(1..=5).contains(&entrada.copies) {
        return Err(AppError::Validation("cópias deve ser de 1 a 5".into()));
    }
    if !(0..=12).contains(&entrada.feed_lines) {
        return Err(AppError::Validation(
            "avanço de papel deve ser de 0 a 12 linhas".into(),
        ));
    }
    if !matches!(entrada.mode.as_str(), "escpos" | "texto" | "navegador") {
        return Err(AppError::Validation("modo de impressão inválido".into()));
    }
    // Só exige nome quando vai imprimir pelo sistema; no modo navegador o
    // diálogo é que escolhe o destino.
    if entrada.mode != "navegador" {
        nome_seguro(&entrada.printer_name)?;
    }

    connection.execute(
        "UPDATE printer_settings
         SET printer_name = ?1, paper_width_mm = ?2, columns = ?3, copies = ?4,
             feed_lines = ?5, cut_paper = ?6, open_drawer = ?7, mode = ?8,
             codepage = ?9, updated_at = ?10
         WHERE id = 1",
        params![
            entrada.printer_name.trim(),
            entrada.paper_width_mm,
            entrada.columns,
            entrada.copies,
            entrada.feed_lines,
            entrada.cut_paper,
            entrada.open_drawer,
            entrada.mode,
            entrada.codepage,
            entrada.auto_print_sale,
            entrada.auto_print_credit,
            entrada.credit_copies.clamp(1, 3),
            Utc::now().to_rfc3339()
        ],
    )?;
    obter_config(connection)
}

/// Manda os bytes para a fila de impressão do sistema.
///
/// No Windows o caminho confiável para dados brutos é escrever num arquivo
/// temporário e copiá-lo para o compartilhamento da impressora. Nos demais
/// sistemas o CUPS recebe pelo `lp -o raw`.
#[cfg(target_os = "windows")]
fn enviar(nome: &str, dados: &[u8]) -> AppResult<()> {
    let nome = nome_seguro(nome)?;
    let temporario = std::env::temp_dir()
        .join(format!("k7-cupom-{}.bin", Utc::now().timestamp_millis()));
    std::fs::write(&temporario, dados)
        .map_err(|e| AppError::Internal(format!("falha ao preparar a impressão: {e}")))?;
    let saida = Command::new("cmd")
        .args(["/C", "copy", "/B"])
        .arg(&temporario)
        .arg(format!("\\\\localhost\\{nome}"))
        .output();
    let _ = std::fs::remove_file(&temporario);
    match saida {
        Ok(r) if r.status.success() => Ok(()),
        Ok(r) => Err(AppError::Internal(format!(
            "a impressora recusou o trabalho: {}",
            String::from_utf8_lossy(&r.stderr).trim()
        ))),
        Err(e) => Err(AppError::Internal(format!(
            "não foi possível falar com a impressora: {e}"
        ))),
    }
}

#[cfg(not(target_os = "windows"))]
fn enviar(nome: &str, dados: &[u8]) -> AppResult<()> {
    let nome = nome_seguro(nome)?;
    let mut processo = Command::new("lp")
        .args(["-d", nome, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::Internal(format!(
                "não foi possível falar com o sistema de impressão: {e}"
            ))
        })?;
    processo
        .stdin
        .as_mut()
        .ok_or_else(|| AppError::Internal("a fila de impressão não aceitou os dados".into()))?
        .write_all(dados)
        .map_err(|e| AppError::Internal(format!("falha ao enviar o cupom: {e}")))?;
    let resultado = processo
        .wait_with_output()
        .map_err(|e| AppError::Internal(format!("a impressão não terminou: {e}")))?;
    if !resultado.status.success() {
        return Err(AppError::Internal(format!(
            "a impressora recusou o trabalho: {}",
            String::from_utf8_lossy(&resultado.stderr).trim()
        )));
    }
    Ok(())
}

/// Monta o cupom de venda em ESC/POS.
///
/// Público para ser testado sem impressora: o que importa é o conteúdo dos
/// bytes, e ele precisa estar certo antes de existir hardware na mesa.
pub fn montar_cupom(
    venda: &CompletedSale,
    ticket: &TicketSettings,
    config: &PrinterSettings,
) -> Vec<u8> {
    let reais = |centavos: i64| -> String {
        format!("R$ {},{:02}", centavos / 100, (centavos % 100).abs())
    };
    let mut c = Cupom::novo(config.columns as usize, config.codepage as u8);

    c.alinhar(Alinhamento::Centro);
    if !ticket.store_name.trim().is_empty() {
        c.negrito(true).linha(&ticket.store_name).negrito(false);
    }
    // Cabeçalho da loja: cada linha só aparece se estiver preenchida, para o
    // cupom não ganhar linhas em branco num cadastro incompleto.
    if !ticket.legal_name.trim().is_empty() {
        c.paragrafo(&ticket.legal_name);
    }
    if !ticket.document.trim().is_empty() {
        c.linha(&formatar_documento(&ticket.document));
    }
    if !ticket.address_line.trim().is_empty() {
        c.paragrafo(&ticket.address_line);
    }
    let cidade = [
        ticket.district.trim(),
        ticket.city.trim(),
        ticket.state.trim(),
    ]
    .iter()
    .filter(|p| !p.is_empty())
    .cloned()
    .collect::<Vec<_>>()
    .join(" - ");
    if !cidade.is_empty() {
        c.paragrafo(&cidade);
    }
    if !ticket.phone.trim().is_empty() {
        c.linha(&ticket.phone);
    }
    if !ticket.fiscal_label.trim().is_empty() {
        c.linha(&ticket.fiscal_label);
    }

    // O número de retirada é o maior elemento do cupom: é por ele que o
    // cliente é chamado, muitas vezes lido de longe.
    if ticket.show_chapelaria {
        c.avancar(1);
        if !ticket.chapelaria_label.trim().is_empty() {
            c.linha(&ticket.chapelaria_label);
        }
        c.tamanho(2)
            .negrito(true)
            .linha(&format!("{:05}", venda.sale_number))
            .negrito(false)
            .tamanho(0);
    }

    c.alinhar(Alinhamento::Esquerda).avancar(1);
    if ticket.show_datetime {
        c.linha(&venda.created_at.chars().take(19).collect::<String>().replace('T', " "));
    }
    if ticket.show_operator && !ticket.operator_label.trim().is_empty() {
        c.linha(&format!("{}: {}", ticket.operator_label, venda.operator_name));
    }

    c.regua();
    for item in &venda.items {
        c.linha(&item.product_name);
        c.par(
            &format!("  {} x {}", item.quantity, reais(item.unit_price_cents)),
            &reais(item.subtotal_cents),
        );
    }
    c.regua();

    if venda.discount_cents > 0 {
        c.par("Subtotal", &reais(venda.subtotal_cents));
        c.par("Desconto", &format!("-{}", reais(venda.discount_cents)));
    }
    c.negrito(true)
        .par("TOTAL", &reais(venda.total_cents))
        .negrito(false);

    if venda.cash_tendered_cents > 0 {
        c.par("Dinheiro", &reais(venda.cash_tendered_cents));
    }
    if venda.card_cents > 0 {
        c.par("Maquininha", &reais(venda.card_cents));
    }
    if venda.pix_cents > 0 {
        c.par("PIX", &reais(venda.pix_cents));
    }
    if venda.change_cents > 0 {
        c.par("Troco", &reais(venda.change_cents));
    }

    if !ticket.footer_message.trim().is_empty() {
        c.avancar(1)
            .alinhar(Alinhamento::Centro)
            .paragrafo(&ticket.footer_message);
    }
    if !ticket.contact_line.trim().is_empty() {
        c.alinhar(Alinhamento::Centro).paragrafo(&ticket.contact_line);
    }

    c.avancar(config.feed_lines as u8);
    if config.open_drawer && venda.cash_tendered_cents > 0 {
        // A gaveta só abre quando entrou dinheiro. Abrir em venda no cartão é
        // convite para o caixa ficar aberto à toa.
        c.abrir_gaveta();
    }
    if config.cut_paper {
        c.cortar();
    }
    c.finalizar()
}

/// Monta a ficha: o comprovante do que o cliente ainda tem para retirar.
///
/// É outro papel que não o cupom. O cupom prova o que foi pago; a ficha prova
/// o que falta buscar, e é ela que o cliente leva no bolso e apresenta na
/// volta. Por isso traz o nome grande — é por ele que o atendente acha o
/// saldo — e a contagem de cada item.
pub fn montar_ficha(
    ficha: &CreditVoucher,
    ticket: &TicketSettings,
    config: &PrinterSettings,
) -> Vec<u8> {
    let mut c = Cupom::novo(config.columns as usize, config.codepage as u8);

    c.alinhar(Alinhamento::Centro);
    if !ticket.store_name.trim().is_empty() {
        c.linha(&ticket.store_name);
    }
    // Pedido do cliente: "FICHA" em letras grandes, para ninguem confundir com cupom.
    c.tamanho(2).negrito(true).linha("FICHA").negrito(false).tamanho(0);
    c.negrito(true).linha("RETIRAR DEPOIS").negrito(false);

    // Ficha ao portador: o código é o que identifica o papel. Sai no maior corpo.
    if !ficha.code.is_empty() {
        c.avancar(1)
            .tamanho(2)
            .negrito(true)
            .linha(&format!("K7-{}", ficha.code))
            .negrito(false)
            .tamanho(0);
    }
    // O nome, quando informado, ajuda a achar — mas não é a chave.
    if !ficha.customer_name.trim().is_empty() {
        c.avancar(1)
            .tamanho(if ficha.code.is_empty() { 2 } else { 1 })
            .negrito(true)
            .paragrafo(&ficha.customer_name)
            .negrito(false)
            .tamanho(0);
    }

    c.avancar(1)
        .alinhar(Alinhamento::Esquerda)
        .par("Pedido", &format!("{:05}", ficha.sale_number))
        .linha(
            &ficha
                .created_at
                .chars()
                .take(19)
                .collect::<String>()
                .replace('T', " "),
        );

    c.regua();
    // O produto e o que o balcao confere: sai em corpo grande, com o que falta.
    for item in &ficha.items {
        let resta = item.quantity - item.taken_quantity;
        c.alinhar(Alinhamento::Centro)
            .tamanho(1)
            .negrito(true)
            .paragrafo(&format!("{resta}x {}", item.product_name))
            .negrito(false)
            .tamanho(0)
            .alinhar(Alinhamento::Esquerda);
        if resta != item.quantity {
            c.par("Ja retirado", &format!("{} de {}", item.taken_quantity, item.quantity));
        }
    }
    c.regua();

    c.alinhar(Alinhamento::Centro).paragrafo(
        "Ficha ao portador. Apresente no balcao para retirar, uma de cada vez.",
    );

    c.avancar(config.feed_lines as u8);
    if config.cut_paper {
        c.cortar();
    }
    c.finalizar()
}

pub fn imprimir_ficha(
    connection: &Connection,
    actor: &LocalUser,
    ficha: &CreditVoucher,
) -> AppResult<()> {
    require(actor, "credit.sell")?;
    let config = obter_config(connection)?;
    if config.mode == "navegador" {
        return Err(AppError::Validation(
            "impressão configurada para o navegador".into(),
        ));
    }
    let ticket = crate::settings::get(connection)?;
    let dados = montar_ficha(ficha, &ticket, &config);
    for _ in 0..config.credit_copies.clamp(1, 3) {
        enviar(&config.printer_name, &dados)?;
    }
    Ok(())
}

/// Página de teste: prova que a configuração está certa antes do movimento.
pub fn montar_teste(config: &PrinterSettings, loja: &str) -> Vec<u8> {
    let mut c = Cupom::novo(config.columns as usize, config.codepage as u8);
    c.alinhar(Alinhamento::Centro)
        .negrito(true)
        .linha("TESTE DE IMPRESSAO")
        .negrito(false);
    if !loja.trim().is_empty() {
        c.linha(loja);
    }
    c.alinhar(Alinhamento::Esquerda).avancar(1).regua();
    c.par("Impressora", &config.printer_name);
    c.par("Papel", &format!("{} mm", config.paper_width_mm));
    c.par("Colunas", &config.columns.to_string());
    c.par("Modo", &config.mode);
    c.par("Cortar papel", if config.cut_paper { "sim" } else { "nao" });
    c.par("Abrir gaveta", if config.open_drawer { "sim" } else { "nao" });
    c.regua();

    // A régua serve para conferir a olho se a largura configurada bate com o
    // papel: se sobrar ou faltar, o número de colunas está errado.
    c.linha(&"1234567890".repeat(config.columns as usize / 10 + 1)
        .chars()
        .take(config.columns as usize)
        .collect::<String>());
    c.linha("Acentuacao: cao, coracao, PREco, ambiguo");
    c.linha("Acentuação: ção, coração, PREÇO, ambíguo");
    c.regua();
    c.paragrafo(
        "Se as duas linhas de acentuacao aparecerem legiveis e a regua de numeros \
         terminar na borda do papel, a configuracao esta correta.",
    );

    c.avancar(config.feed_lines as u8);
    if config.cut_paper {
        c.cortar();
    }
    c.finalizar()
}

/// Imprime a venda lendo-a do banco pelo id.
///
/// A tela manda só o identificador. Aceitar o cupom pronto do React deixaria o
/// papel dizer um total diferente do que está gravado — o mesmo motivo pelo
/// qual o preço da venda é relido no banco na hora de fechar.
pub fn imprimir_cupom_por_id(
    connection: &Connection,
    actor: &LocalUser,
    sale_id: &str,
) -> AppResult<()> {
    let venda = crate::sales::find_by_id(connection, sale_id)?.ok_or(AppError::NotFound)?;
    imprimir_cupom(connection, actor, &venda)
}

pub fn imprimir_cupom(
    connection: &Connection,
    actor: &LocalUser,
    venda: &CompletedSale,
) -> AppResult<()> {
    require(actor, "pdv.use")?;
    let config = obter_config(connection)?;
    if config.mode == "navegador" {
        return Err(AppError::Validation(
            "impressão configurada para o navegador; a tela é que imprime".into(),
        ));
    }
    let ticket = crate::settings::get(connection)?;
    let dados = montar_cupom(venda, &ticket, &config);
    for _ in 0..config.copies.max(1) {
        enviar(&config.printer_name, &dados)?;
    }
    Ok(())
}

pub fn imprimir_teste(connection: &Connection, actor: &LocalUser) -> AppResult<()> {
    require(actor, "printer.configure")?;
    let config = obter_config(connection)?;
    if config.mode == "navegador" {
        return Err(AppError::Validation(
            "no modo navegador não há impressora do sistema para testar".into(),
        ));
    }
    let ticket = crate::settings::get(connection)?;
    let dados = montar_teste(&config, &ticket.store_name);
    enviar(&config.printer_name, &dados)
}

/// Pulso avulso na gaveta, para quando é preciso abri-la fora de uma venda.
pub fn abrir_gaveta(connection: &Connection, actor: &LocalUser) -> AppResult<()> {
    require(actor, "cash.operate")?;
    let config = obter_config(connection)?;
    if config.mode == "navegador" {
        return Err(AppError::Validation(
            "a gaveta depende da impressora do sistema".into(),
        ));
    }
    let mut c = Cupom::novo(config.columns as usize, config.codepage as u8);
    c.abrir_gaveta();
    enviar(&config.printer_name, &c.finalizar())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CompletedSaleItem;

    fn config() -> PrinterSettings {
        PrinterSettings {
            printer_name: "TERMICA".into(),
            paper_width_mm: 80,
            columns: 48,
            copies: 1,
            feed_lines: 4,
            cut_paper: true,
            open_drawer: true,
            mode: "escpos".into(),
            codepage: 16,
            auto_print_sale: true,
            auto_print_credit: true,
            credit_copies: 1,
        }
    }

    fn venda() -> CompletedSale {
        CompletedSale {
            id: "s1".into(),
            subtotal_cents: 6000,
            discount_cents: 600,
            pix_cents: 0,
            client_sale_id: "c1".into(),
            sale_number: 42,
            business_date: "2026-09-04".into(),
            total_cents: 5400,
            cash_tendered_cents: 6000,
            card_cents: 0,
            change_cents: 600,
            operator_name: "Ana".into(),
            created_at: "2026-09-04T14:30:00Z".into(),
            items: vec![CompletedSaleItem {
                product_id: "p1".into(),
                product_code: "B1".into(),
                product_name: "Cerveja".into(),
                category: "Bebidas".into(),
                unit_price_cents: 3000,
                quantity: 2,
                subtotal_cents: 6000,
            }],
        }
    }

    fn texto(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).to_string()
    }

    #[test]
    fn o_cupom_traz_numero_itens_total_e_troco() {
        let t = crate::models::TicketSettings::default();
        let saida = texto(&montar_cupom(&venda(), &t, &config()));
        assert!(saida.contains("00042"), "número de retirada em cinco dígitos");
        assert!(saida.contains("Cerveja"));
        assert!(saida.contains("TOTAL"));
        assert!(saida.contains("R$ 54,00"));
        assert!(saida.contains("Troco"));
    }

    #[test]
    fn o_desconto_aparece_com_o_subtotal_acima() {
        let t = crate::models::TicketSettings::default();
        let saida = texto(&montar_cupom(&venda(), &t, &config()));
        assert!(saida.contains("Subtotal"));
        assert!(saida.contains("Desconto"));
        assert!(saida.contains("-R$ 6,00"));
    }

    #[test]
    fn a_gaveta_nao_abre_em_venda_sem_dinheiro() {
        let t = crate::models::TicketSettings::default();
        let mut so_cartao = venda();
        so_cartao.cash_tendered_cents = 0;
        so_cartao.card_cents = 5400;
        so_cartao.change_cents = 0;

        let pulso = [0x1B, b'p', 0, 25, 250];
        let com_dinheiro = montar_cupom(&venda(), &t, &config());
        let sem_dinheiro = montar_cupom(&so_cartao, &t, &config());
        assert!(com_dinheiro.windows(5).any(|j| j == pulso));
        assert!(
            !sem_dinheiro.windows(5).any(|j| j == pulso),
            "abrir a gaveta em venda no cartão deixa o caixa aberto à toa"
        );
    }

    #[test]
    fn sem_corte_configurado_o_comando_nao_e_emitido() {
        let t = crate::models::TicketSettings::default();
        let mut sem_corte = config();
        sem_corte.cut_paper = false;
        let bytes = montar_cupom(&venda(), &t, &sem_corte);
        assert!(!bytes.windows(4).any(|j| j == [0x1D, b'V', 66, 0]));
    }

    #[test]
    fn a_pagina_de_teste_mostra_a_regua_na_largura_configurada() {
        let mut estreita = config();
        estreita.columns = 32;
        let saida = texto(&montar_teste(&estreita, "K7 Cabines"));
        let regua = saida
            .lines()
            .find(|l| l.starts_with("1234567890"))
            .expect("a régua precisa existir");
        assert_eq!(regua.chars().count(), 32);
        assert!(saida.contains("TESTE DE IMPRESSAO"));
    }

    #[test]
    fn o_cabecalho_traz_os_dados_da_loja_e_pula_o_que_falta() {
        // Telefone e razão social ficam vazios de propósito.
        let t = crate::models::TicketSettings {
            store_name: "K7 Cabines".into(),
            document: "11222333000181".into(),
            address_line: "Rua das Flores, 100".into(),
            city: "Rio de Janeiro".into(),
            state: "RJ".into(),
            district: "Pavuna".into(),
            ..Default::default()
        };
        let saida = texto(&montar_cupom(&venda(), &t, &config()));
        assert!(saida.contains("CNPJ 11.222.333/0001-81"));
        assert!(saida.contains("Rua das Flores, 100"));
        assert!(saida.contains("Pavuna - Rio de Janeiro - RJ"));
        // Campo vazio não vira linha em branco no papel.
        assert!(!saida.contains("\n\n\nRua"));
    }

    #[test]
    fn documento_e_formatado_conforme_o_comprimento() {
        assert_eq!(formatar_documento("11222333000181"), "CNPJ 11.222.333/0001-81");
        assert_eq!(formatar_documento("52998224725"), "CPF 529.982.247-25");
        assert_eq!(formatar_documento(""), "");
    }

    #[test]
    fn a_ficha_traz_o_nome_grande_e_o_que_falta_retirar() {
        let t = crate::models::TicketSettings {
            store_name: "K7 Cabines".into(),
            ..Default::default()
        };
        let ficha = CreditVoucher {
            id: "f1".into(),
            sale_id: "s1".into(),
            sale_number: 42,
            code: "3F9A".into(),
            customer_name: "João da mesa 4".into(),
            created_at: "2026-09-10T20:15:00Z".into(),
            settled_at: None,
            items: vec![crate::models::CreditVoucherItem {
                id: "i1".into(),
                product_id: Some("p1".into()),
                product_name: "Brahma".into(),
                category: "Bebidas".into(),
                quantity: 5,
                taken_quantity: 2,
            }],
        };
        let saida = texto(&montar_ficha(&ficha, &t, &config()));
        assert!(saida.contains("FICHA"));
        assert!(saida.contains("RETIRAR DEPOIS"));
        assert!(saida.contains("00042"), "o número do pedido resolve homônimo");
        assert!(saida.contains("Brahma"));
        assert!(saida.contains("3x Brahma"), "o papel mostra o que ainda falta");
        assert!(saida.contains("2 de 5"), "e o que ja foi retirado");
        assert!(saida.contains("K7-3F9A"), "o código identifica a ficha ao portador");
        // O código sai em corpo dobrado: é por ele que a retirada é achada.
        assert!(montar_ficha(&ficha, &t, &config())
            .windows(3)
            .any(|j| j == [0x1D, b'!', 0x11]));
    }

    #[test]
    fn nome_de_impressora_com_quebra_de_linha_e_recusado() {
        assert!(nome_seguro("TERMICA").is_ok());
        assert!(nome_seguro("  ").is_err());
        assert!(nome_seguro("TER\nMICA").is_err());
        assert!(nome_seguro(&"X".repeat(200)).is_err());
        // Metacaracteres de shell: o nome vira argumento de `cmd` no Windows.
        assert!(nome_seguro("HP&calc.exe").is_err());
        assert!(nome_seguro("HP|calc").is_err());
        assert!(nome_seguro("HP^x").is_err());
        assert!(nome_seguro("HP>saida.txt").is_err());
        // Nomes reais de impressora continuam passando.
        assert!(nome_seguro("EPSON_L3250_Series").is_ok());
        assert!(nome_seguro("HP LaserJet 1020 (cópia 2)").is_ok());
    }
}

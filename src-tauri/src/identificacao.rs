//! Identificação de produto: SKU interno e GTIN (o "código de barras").
//!
//! São duas coisas diferentes e o sistema tratava as duas como texto livre.
//! SKU é o código que a loja escolhe e usa para procurar no balcão. GTIN é o
//! número impresso pelo fabricante na embalagem, com dígito verificador — se
//! ele não confere, o leitor da loja nunca vai encontrar o produto, e a falha
//! só aparece na fila. Validar na hora do cadastro é mais barato.

use crate::error::{AppError, AppResult};

/// Comprimento máximo do SKU. Cabe em etiqueta e na coluna da tabela.
const SKU_MAX: usize = 24;
const SKU_MIN: usize = 2;

/// Normaliza o SKU: maiúsculas, sem espaços, alfanumérico com `-`, `.` e `_`.
///
/// Maiúsculo porque o índice é `COLLATE NOCASE`: guardar `b1` e `B1` como
/// registros diferentes seria mentira, e o operador digita sem olhar.
pub fn normaliza_sku(bruto: &str) -> AppResult<String> {
    let limpo: String = bruto.trim().to_uppercase().replace(' ', "-");
    if limpo.chars().count() < SKU_MIN {
        return Err(AppError::Validation(
            "o SKU precisa de pelo menos 2 caracteres".into(),
        ));
    }
    if limpo.chars().count() > SKU_MAX {
        return Err(AppError::Validation(format!(
            "o SKU pode ter no máximo {SKU_MAX} caracteres"
        )));
    }
    if !limpo
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
    {
        return Err(AppError::Validation(
            "o SKU aceita letras, números, hífen, ponto e sublinhado".into(),
        ));
    }
    Ok(limpo)
}

/// Tipo do GTIN pelo comprimento. Todos usam o mesmo dígito verificador GS1.
pub fn tipo_gtin(digitos: &str) -> Option<&'static str> {
    match digitos.len() {
        8 => Some("EAN-8"),
        12 => Some("UPC-A"),
        13 => Some("EAN-13"),
        14 => Some("DUN-14"),
        _ => None,
    }
}

/// Confere o dígito verificador GS1 (módulo 10, pesos 3 e 1 da direita).
fn digito_confere(digitos: &str) -> bool {
    let valores: Vec<u32> = digitos.chars().filter_map(|c| c.to_digit(10)).collect();
    if valores.len() != digitos.len() || valores.is_empty() {
        return false;
    }
    let (informado, corpo) = valores.split_last().expect("comprimento já verificado");
    // Pesos alternam a partir do dígito imediatamente à esquerda do verificador.
    let soma: u32 = corpo
        .iter()
        .rev()
        .enumerate()
        .map(|(i, d)| d * if i % 2 == 0 { 3 } else { 1 })
        .sum();
    (10 - soma % 10) % 10 == *informado
}

/// Normaliza o GTIN. Vazio vira `None`: nem todo produto de sexshop tem EAN.
///
/// Aceita separadores usados em etiqueta impressa e recusa qualquer número que
/// não feche o dígito verificador — um EAN inventado é pior que nenhum, porque
/// o operador procura, não acha, e conclui que o sistema está errado.
pub fn normaliza_gtin(bruto: Option<&str>) -> AppResult<Option<String>> {
    let Some(texto) = bruto else { return Ok(None) };
    let digitos: String = texto
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '.' | '\t'))
        .collect();
    if digitos.is_empty() {
        return Ok(None);
    }
    if !digitos.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "o código de barras aceita apenas números".into(),
        ));
    }
    if tipo_gtin(&digitos).is_none() {
        return Err(AppError::Validation(format!(
            "código de barras com {} dígitos não existe: use 8, 12, 13 ou 14",
            digitos.len()
        )));
    }
    if !digito_confere(&digitos) {
        return Err(AppError::Validation(
            "o dígito verificador do código de barras não confere; confira a leitura".into(),
        ));
    }
    Ok(Some(digitos))
}

/// Unidades de medida aceitas. Lista fechada porque unidade é para conferir
/// estoque, e texto livre transforma "UN", "un" e "unid" em três unidades.
pub const UNIDADES: [&str; 6] = ["UN", "CX", "PC", "PAR", "ML", "G"];

pub fn normaliza_unidade(bruto: &str) -> AppResult<String> {
    let limpo = bruto.trim().to_uppercase();
    if limpo.is_empty() {
        return Ok("UN".into());
    }
    if !UNIDADES.contains(&limpo.as_str()) {
        return Err(AppError::Validation(format!(
            "unidade inválida; use uma de: {}",
            UNIDADES.join(", ")
        )));
    }
    Ok(limpo)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gtin_valido_de_cada_comprimento_passa() {
        // EAN-13 real de refrigerante, EAN-8, UPC-A e DUN-14 com dígito correto.
        for codigo in ["7894900011517", "40170725", "012000161155", "17894900011514"] {
            let saida = normaliza_gtin(Some(codigo)).unwrap();
            assert_eq!(saida.as_deref(), Some(codigo), "falhou em {codigo}");
            assert!(tipo_gtin(codigo).is_some());
        }
    }

    #[test]
    fn separadores_de_etiqueta_sao_removidos() {
        assert_eq!(
            normaliza_gtin(Some(" 789 4900 011517 ")).unwrap().as_deref(),
            Some("7894900011517")
        );
    }

    #[test]
    fn gtin_vazio_vira_none_e_nao_erro() {
        assert_eq!(normaliza_gtin(Some("   ")).unwrap(), None);
        assert_eq!(normaliza_gtin(None).unwrap(), None);
    }

    #[test]
    fn digito_verificador_errado_e_recusado() {
        // Mesmo EAN com o último dígito trocado.
        let erro = normaliza_gtin(Some("7894900011518"));
        assert!(matches!(erro, Err(AppError::Validation(_))));
    }

    #[test]
    fn comprimento_invalido_e_recusado_com_a_lista_certa() {
        let erro = normaliza_gtin(Some("789")).unwrap_err();
        assert!(erro.to_string().contains("8, 12, 13 ou 14"));
    }

    #[test]
    fn letra_no_codigo_de_barras_e_recusada() {
        assert!(matches!(
            normaliza_gtin(Some("789490001151X")),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn sku_normaliza_caixa_e_espaco() {
        assert_eq!(normaliza_sku(" gel 50 ").unwrap(), "GEL-50");
    }

    #[test]
    fn sku_recusa_curto_longo_e_simbolo() {
        assert!(normaliza_sku("a").is_err());
        assert!(normaliza_sku(&"A".repeat(25)).is_err());
        assert!(normaliza_sku("GEL/50").is_err());
    }

    #[test]
    fn unidade_fora_da_lista_e_recusada_e_vazia_vira_un() {
        assert_eq!(normaliza_unidade("").unwrap(), "UN");
        assert_eq!(normaliza_unidade("cx").unwrap(), "CX");
        assert!(normaliza_unidade("unid").is_err());
    }
}

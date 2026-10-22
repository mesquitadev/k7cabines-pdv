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

/// Tamanho da etiqueta interna: curta o bastante para caber numa etiqueta
/// colada à mão, longa o bastante para um código de fornecedor.
const ETIQUETA_MIN: usize = 3;
const ETIQUETA_MAX: usize = 20;

/// Normaliza o código de barras. Vazio vira `None`: nem todo produto tem.
///
/// Dois mundos convivem no mesmo campo. O GTIN do fabricante (8, 12, 13 ou 14
/// dígitos) tem dígito verificador e ele é conferido: um EAN inventado é pior
/// que nenhum, porque o operador procura, não acha, e conclui que o sistema
/// está errado. Já a mercadoria importada chega sem código legível e a loja
/// cola uma etiqueta própria, com poucas letras ("APCB"): isso é aceito como
/// etiqueta interna, sem dígito verificador, em maiúsculas.
pub fn normaliza_gtin(bruto: Option<&str>) -> AppResult<Option<String>> {
    let Some(texto) = bruto else { return Ok(None) };
    let limpo: String = texto
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '.' | '\t'))
        .collect::<String>()
        .to_uppercase();
    if limpo.is_empty() {
        return Ok(None);
    }
    let so_digitos = limpo.chars().all(|c| c.is_ascii_digit());
    if so_digitos && tipo_gtin(&limpo).is_some() {
        if !digito_confere(&limpo) {
            return Err(AppError::Validation(
                "o dígito verificador do código de barras não confere; confira a leitura".into(),
            ));
        }
        return Ok(Some(limpo));
    }
    if !limpo.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Validation(
            "o código de barras aceita letras e números, sem símbolos".into(),
        ));
    }
    let n = limpo.chars().count();
    if !(ETIQUETA_MIN..=ETIQUETA_MAX).contains(&n) {
        return Err(AppError::Validation(format!(
            "etiqueta interna com {n} caracteres: use de {ETIQUETA_MIN} a {ETIQUETA_MAX}"
        )));
    }
    Ok(Some(limpo))
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
    fn etiqueta_interna_curta_com_letras_e_aceita_em_maiusculas() {
        // Produto importado sem EAN legível: a loja cola uma etiqueta "APCB".
        assert_eq!(normaliza_gtin(Some("apcb")).unwrap().as_deref(), Some("APCB"));
        assert_eq!(normaliza_gtin(Some("789")).unwrap().as_deref(), Some("789"));
        assert_eq!(normaliza_gtin(Some("K7 12")).unwrap().as_deref(), Some("K712"));
    }

    #[test]
    fn etiqueta_interna_recusa_simbolo_e_tamanho_fora_da_faixa() {
        assert!(matches!(normaliza_gtin(Some("AP/CB")), Err(AppError::Validation(_))));
        assert!(matches!(normaliza_gtin(Some("AB")), Err(AppError::Validation(_))));
        assert!(matches!(
            normaliza_gtin(Some(&"A".repeat(21))),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn numero_com_tamanho_de_gtin_ainda_confere_o_digito() {
        // 13 dígitos é leitura de embalagem: dígito verificador errado é recusado.
        assert!(matches!(
            normaliza_gtin(Some("7894900011518")),
            Err(AppError::Validation(_))
        ));
        // Com letra deixa de ser GTIN e passa a valer como etiqueta interna.
        assert_eq!(
            normaliza_gtin(Some("789490001151X")).unwrap().as_deref(),
            Some("789490001151X")
        );
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

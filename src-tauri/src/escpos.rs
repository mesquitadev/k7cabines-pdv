//! Geração de ESC/POS: o cupom vira bytes que a impressora térmica entende.
//!
//! Por que não usar o `window.print()` do WebView: ele abre o diálogo do
//! sistema, que no balcão significa uma confirmação por cupom, com a fila
//! esperando. E o diálogo não corta o papel nem abre a gaveta — são comandos
//! que só existem no protocolo da impressora.

/// Comandos do padrão ESC/POS usados aqui.
mod cmd {
    pub const ESC: u8 = 0x1B;
    pub const GS: u8 = 0x1D;
    pub const LF: u8 = 0x0A;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alinhamento {
    Esquerda,
    Centro,
}

/// Montador do fluxo de bytes do cupom.
pub struct Cupom {
    bytes: Vec<u8>,
    colunas: usize,
    codepage: u8,
}

impl Cupom {
    pub fn novo(colunas: usize, codepage: u8) -> Self {
        let mut cupom = Self {
            bytes: Vec::with_capacity(1024),
            colunas: colunas.clamp(24, 64),
            codepage,
        };
        // ESC @ zera a impressora: sem isso ela herda negrito ou alinhamento
        // do cupom anterior quando o trabalho anterior falhou no meio.
        cupom.bytes.extend_from_slice(&[cmd::ESC, b'@']);
        // ESC t n escolhe a tabela de acentos.
        cupom.bytes.extend_from_slice(&[cmd::ESC, b't', codepage]);
        cupom
    }

    pub fn alinhar(&mut self, a: Alinhamento) -> &mut Self {
        let n = match a {
            Alinhamento::Esquerda => 0,
            Alinhamento::Centro => 1,
        };
        self.bytes.extend_from_slice(&[cmd::ESC, b'a', n]);
        self
    }

    pub fn negrito(&mut self, ligado: bool) -> &mut Self {
        self.bytes
            .extend_from_slice(&[cmd::ESC, b'E', u8::from(ligado)]);
        self
    }

    /// Tamanho do caractere: 0 é normal, 1 dobra a altura, 2 dobra tudo.
    pub fn tamanho(&mut self, escala: u8) -> &mut Self {
        let n = match escala {
            0 => 0x00,
            1 => 0x01, // dobro da altura
            _ => 0x11, // dobro da altura e da largura
        };
        self.bytes.extend_from_slice(&[cmd::GS, b'!', n]);
        self
    }

    /// Escreve uma linha já convertida para a tabela de acentos da impressora.
    pub fn linha(&mut self, texto: &str) -> &mut Self {
        self.bytes.extend_from_slice(&codificar(texto, self.codepage));
        self.bytes.push(cmd::LF);
        self
    }

    /// Rótulo à esquerda e valor à direita, preenchendo o meio com espaços.
    ///
    /// É o formato de toda linha de total. Fazer isso com espaços contados, e
    /// não com tabulação, é o que garante que a coluna da direita fecha na
    /// margem em qualquer impressora.
    pub fn par(&mut self, esquerda: &str, direita: &str) -> &mut Self {
        let texto = formatar_par(esquerda, direita, self.colunas);
        self.linha(&texto)
    }

    /// Régua tracejada da largura do papel.
    pub fn regua(&mut self) -> &mut Self {
        let traco = "-".repeat(self.colunas);
        self.linha(&traco)
    }

    /// Texto longo quebrado na largura do papel, sem cortar palavra no meio.
    pub fn paragrafo(&mut self, texto: &str) -> &mut Self {
        for linha in quebrar(texto, self.colunas) {
            self.linha(&linha);
        }
        self
    }

    pub fn avancar(&mut self, linhas: u8) -> &mut Self {
        for _ in 0..linhas {
            self.bytes.push(cmd::LF);
        }
        self
    }

    /// Corte parcial: deixa um filete de papel para o cupom não cair no chão.
    pub fn cortar(&mut self) -> &mut Self {
        self.bytes.extend_from_slice(&[cmd::GS, b'V', 66, 0]);
        self
    }

    /// Pulso na gaveta de dinheiro, ligada à impressora pelo conector RJ-11.
    pub fn abrir_gaveta(&mut self) -> &mut Self {
        self.bytes
            .extend_from_slice(&[cmd::ESC, b'p', 0, 25, 250]);
        self
    }

    pub fn finalizar(self) -> Vec<u8> {
        self.bytes
    }
}

/// Rótulo à esquerda, valor à direita, espaços no meio.
///
/// Função livre para poder ser testada sem montar um fluxo de bytes: é aqui
/// que mora a regra que faz a coluna de valores fechar na margem.
fn formatar_par(esquerda: &str, direita: &str, colunas: usize) -> String {
    let largura_direita = direita.chars().count();
    let disponivel = colunas.saturating_sub(largura_direita);
    // Quem cede é o rótulo: o valor é o que não pode ser perdido.
    let esquerda_cortada: String = esquerda.chars().take(disponivel).collect();
    let preenchimento = colunas.saturating_sub(esquerda_cortada.chars().count() + largura_direita);
    format!("{esquerda_cortada}{}{direita}", " ".repeat(preenchimento))
}

/// Quebra o texto na largura do papel sem partir palavra.
fn quebrar(texto: &str, colunas: usize) -> Vec<String> {
    let mut linhas = Vec::new();
    let mut atual = String::new();
    for palavra in texto.split_whitespace() {
        if atual.is_empty() {
            atual = palavra.to_string();
        } else if atual.chars().count() + 1 + palavra.chars().count() <= colunas {
            atual.push(' ');
            atual.push_str(palavra);
        } else {
            linhas.push(std::mem::take(&mut atual));
            atual = palavra.to_string();
        }
    }
    if !atual.is_empty() {
        linhas.push(atual);
    }
    linhas
}

/// Converte o texto para a página de código da impressora.
///
/// A térmica não fala UTF-8: um "ç" em dois bytes vira dois caracteres tortos.
/// Para a WPC1252 (codepage 16), que é o padrão de fato no Brasil, existe uma
/// correspondência direta. Para as demais, o acento é removido — feio, mas
/// legível, que é melhor que lixo.
fn codificar(texto: &str, codepage: u8) -> Vec<u8> {
    texto
        .chars()
        .map(|c| {
            if c.is_ascii() {
                return c as u8;
            }
            if codepage == 16 {
                // WPC1252 coincide com o Latin-1 na faixa acentuada.
                if let Some(byte) = u32::from(c).try_into().ok().filter(|b: &u8| *b >= 0xA0) {
                    return byte;
                }
            }
            sem_acento(c)
        })
        .collect()
}

fn sem_acento(c: char) -> u8 {
    let equivalente = match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'A',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'É' | 'È' | 'Ê' | 'Ë' => 'E',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'O',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
        'ç' => 'c',
        'Ç' => 'C',
        'ñ' => 'n',
        'Ñ' => 'N',
        _ => '?',
    };
    equivalente as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn par_alinha_o_valor_na_margem_direita() {
        let linha = formatar_par("TOTAL", "R$ 54,00", 32);
        assert_eq!(linha.chars().count(), 32);
        assert!(linha.starts_with("TOTAL"));
        assert!(linha.ends_with("R$ 54,00"));
    }

    #[test]
    fn par_corta_a_esquerda_em_vez_de_empurrar_o_valor() {
        // O valor é o que não pode ser perdido: o nome do produto cede.
        let linha = formatar_par("Gel Dessensibilizante Extra Forte", "R$ 120,00", 24);
        assert_eq!(linha.chars().count(), 24);
        assert!(linha.ends_with("R$ 120,00"));
    }

    #[test]
    fn par_nao_estoura_quando_o_valor_ja_ocupa_a_linha() {
        let linha = formatar_par("TOTAL", "R$ 1.234.567,89", 12);
        assert!(linha.ends_with("R$ 1.234.567,89"));
    }

    #[test]
    fn paragrafo_quebra_sem_partir_palavra() {
        let linhas = quebrar("obrigado pela preferencia volte sempre", 20);
        for linha in &linhas {
            assert!(linha.chars().count() <= 20, "linha longa: {linha:?}");
        }
        assert!(linhas.iter().any(|l| l.contains("preferencia")));
    }

    #[test]
    fn acento_vira_byte_unico_na_wpc1252() {
        // "ç" em UTF-8 são dois bytes; na impressora tem que ser um só.
        let bytes = codificar("ção", 16);
        assert_eq!(bytes.len(), 3);
        assert_eq!(bytes[0], 0xE7);
    }

    #[test]
    fn codepage_desconhecida_remove_acento_em_vez_de_imprimir_lixo() {
        assert_eq!(codificar("ção", 99), b"cao".to_vec());
        assert_eq!(codificar("PREÇO", 99), b"PRECO".to_vec());
    }

    #[test]
    fn o_fluxo_comeca_zerando_a_impressora() {
        let c = Cupom::novo(48, 16);
        let bytes = c.finalizar();
        assert_eq!(&bytes[0..2], &[0x1B, b'@'], "ESC @ precisa vir primeiro");
    }

    #[test]
    fn corte_e_gaveta_emitem_os_comandos_do_padrao() {
        let mut c = Cupom::novo(48, 16);
        c.cortar().abrir_gaveta();
        let bytes = c.finalizar();
        assert!(bytes.windows(4).any(|j| j == [0x1D, b'V', 66, 0]));
        assert!(bytes.windows(5).any(|j| j == [0x1B, b'p', 0, 25, 250]));
    }
}

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, Printer, RefreshCcw, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Selecao } from "@/components/selecao";
import { Rotulo } from "@/components/placa";
import { Ajuda } from "@/components/ajuda";
import { desktop, desktopToken, type LocalPrinterSettings } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * Configuração da impressora da estação.
 *
 * Fica separada do Cupom de propósito: o conteúdo do cupom é da loja e viaja no
 * template entre lojas; a impressora é da máquina. Exportar um template com o
 * nome de uma impressora que só existe num balcão quebraria a outra loja.
 */

const MODOS = [
  {
    valor: "escpos",
    rotulo: "Impressora térmica (ESC/POS)",
    ajuda: "Imprime direto, sem diálogo, e pode cortar o papel e abrir a gaveta.",
  },
  {
    valor: "texto",
    rotulo: "Impressora comum (texto)",
    ajuda: "Manda o texto sem comandos de corte. Para impressora de folha A4.",
  },
  {
    valor: "navegador",
    rotulo: "Diálogo do sistema",
    ajuda: "O antigo: abre a caixa de impressão a cada cupom. Use só como saída de emergência.",
  },
];

const PADRAO: LocalPrinterSettings = {
  printer_name: "",
  paper_width_mm: 80,
  columns: 48,
  copies: 1,
  feed_lines: 4,
  cut_paper: true,
  open_drawer: false,
  mode: "escpos",
  codepage: 16,
  auto_print_sale: true,
  auto_print_credit: true,
  credit_copies: 1,
};

/** Colunas que cabem em cada papel, na fonte padrão da térmica. */
const COLUNAS_SUGERIDAS: Record<number, number> = { 58: 32, 80: 48 };

function Interruptor({
  rotulo,
  ajuda,
  ligado,
  onChange,
}: {
  rotulo: string;
  ajuda: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border border-border p-3">
      <input
        type="checkbox"
        className="marcador mt-0.5 shrink-0"
        checked={ligado}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm">{rotulo}</span>
        <span className="block text-xs text-muted-foreground">{ajuda}</span>
      </span>
    </label>
  );
}

export function ConfigImpressora({ podeConfigurar }: { podeConfigurar: boolean }) {
  const [config, setConfig] = useState<LocalPrinterSettings>(PADRAO);
  const [impressoras, setImpressoras] = useState<string[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  const carregar = useCallback(async () => {
    const token = desktopToken();
    if (!token) return;
    try {
      setConfig(await desktop.getPrinterSettings(token));
    } catch {
      setConfig(PADRAO);
    }
  }, []);

  const procurar = useCallback(async () => {
    const token = desktopToken();
    if (!token) return;
    setCarregandoLista(true);
    try {
      setImpressoras(await desktop.listSystemPrinters(token));
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível listar as impressoras");
    } finally {
      setCarregandoLista(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    procurar();
  }, [carregar, procurar]);

  const upd = <K extends keyof LocalPrinterSettings>(campo: K, valor: LocalPrinterSettings[K]) =>
    setConfig((c) => ({ ...c, [campo]: valor }));

  const trocarPapel = (mm: number) =>
    // Trocar o papel sem trocar as colunas imprime cortado ou com sobra: as
    // duas coisas andam juntas, então a sugestão vem junto.
    setConfig((c) => ({ ...c, paper_width_mm: mm, columns: COLUNAS_SUGERIDAS[mm] ?? c.columns }));

  const salvar = async () => {
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    setSalvando(true);
    try {
      setConfig(await desktop.savePrinterSettings(token, config));
      toast.success("Impressora configurada");
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    const token = desktopToken();
    if (!token) return;
    setTestando(true);
    try {
      // Salva antes: testar o que está na tela e não no banco daria um teste
      // que passa e uma venda que falha.
      await desktop.savePrinterSettings(token, config);
      await desktop.printTestPage(token);
      toast.success("Página de teste enviada. Confira o papel.");
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "A impressora não respondeu");
    } finally {
      setTestando(false);
    }
  };

  const abrirGaveta = async () => {
    const token = desktopToken();
    if (!token) return;
    try {
      await desktop.openCashDrawer(token);
      toast.success("Pulso enviado à gaveta");
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "A gaveta não respondeu");
    }
  };

  const semSistema = config.mode !== "navegador";
  const modoAtual = MODOS.find((m) => m.valor === config.mode);

  return (
    <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
      <section className="placa p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <Printer className="h-4 w-4" aria-hidden /> Dispositivo
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Onde o cupom é impresso. A escolha vale só nesta máquina.
        </p>

        <div className="space-y-3">
          <Selecao
            id="impModo"
            rotulo="Como imprimir"
            valor={config.mode}
            onChange={(v) => upd("mode", v as LocalPrinterSettings["mode"])}
            disabled={!podeConfigurar}
            opcoes={MODOS.map((m) => ({ valor: m.valor, rotulo: m.rotulo }))}
            ajuda={modoAtual?.ajuda}
          />

          {semSistema && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="impNome">Impressora</Label>
                <button
                  type="button"
                  onClick={procurar}
                  disabled={carregandoLista}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <RefreshCcw
                    className={cn("h-3 w-3", carregandoLista && "animate-spin")}
                    aria-hidden
                  />
                  Procurar
                </button>
              </div>

              {impressoras.length > 0 ? (
                <Selecao
                  id="impNome"
                  valor={config.printer_name}
                  onChange={(v) => upd("printer_name", v)}
                  disabled={!podeConfigurar}
                  placeholder="Escolha a impressora"
                  opcoes={impressoras.map((n) => ({ valor: n, rotulo: n }))}
                />
              ) : (
                <>
                  <Input
                    id="impNome"
                    value={config.printer_name}
                    onChange={(e) => upd("printer_name", e.target.value)}
                    disabled={!podeConfigurar}
                    placeholder="Digite o nome exato da impressora"
                    className="campo h-11 rounded-sm"
                  />
                  <p className="text-xs" style={{ color: "var(--warning)" }}>
                    Nenhuma impressora encontrada no sistema. Instale-a primeiro, ou digite o nome
                    exato como aparece nas configurações do computador.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {semSistema && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              className="campo h-11 rounded-sm"
              disabled={testando || !config.printer_name}
              onClick={testar}
            >
              <TestTube className="mr-2 h-4 w-4" aria-hidden />
              {testando ? "Enviando…" : "Imprimir teste"}
            </Button>
            {config.open_drawer && (
              <Button
                variant="outline"
                className="campo h-11 rounded-sm"
                disabled={!config.printer_name}
                onClick={abrirGaveta}
              >
                <Inbox className="mr-2 h-4 w-4" aria-hidden /> Abrir gaveta
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="placa p-5">
        <h2 className="text-lg">Papel e comportamento</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          A página de teste traz uma régua numerada: se ela terminar exatamente na borda, as
          colunas estão certas.
        </p>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Rotulo>Largura do papel</Rotulo>
            <div className="flex gap-2">
              {[58, 80].map((mm) => (
                <button
                  key={mm}
                  type="button"
                  disabled={!podeConfigurar}
                  onClick={() => trocarPapel(mm)}
                  aria-pressed={config.paper_width_mm === mm}
                  className={cn(
                    "rotulo h-11 flex-1 border text-[12px] transition-colors disabled:opacity-50",
                    config.paper_width_mm === mm
                      ? "border-transparent bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {mm} mm
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="impCol">Colunas</Label>
                <Ajuda>
                  Quantos caracteres cabem numa linha. 32 para papel de 58 mm, 48 para 80 mm. Se o
                  texto quebrar cedo demais, aumente; se passar da borda, diminua.
                </Ajuda>
              </div>
              <Input
                id="impCol"
                type="number"
                min="24"
                max="64"
                value={config.columns}
                onChange={(e) => upd("columns", parseInt(e.target.value, 10) || 48)}
                disabled={!podeConfigurar}
                className="campo num h-11 rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="impCopias">Vias</Label>
              <Input
                id="impCopias"
                type="number"
                min="1"
                max="5"
                value={config.copies}
                onChange={(e) => upd("copies", parseInt(e.target.value, 10) || 1)}
                disabled={!podeConfigurar}
                className="campo num h-11 rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="impAvanco">Avanço</Label>
                <Ajuda>
                  Linhas em branco antes do corte, para o papel passar da serrilha. Se o cupom sai
                  cortando a última linha, aumente.
                </Ajuda>
              </div>
              <Input
                id="impAvanco"
                type="number"
                min="0"
                max="12"
                value={config.feed_lines}
                onChange={(e) => upd("feed_lines", parseInt(e.target.value, 10) || 0)}
                disabled={!podeConfigurar}
                className="campo num h-11 rounded-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Interruptor
              rotulo="Imprimir o cupom sozinho"
              ajuda="Ao emitir a venda o cupom sai sem ninguém pedir. Desligue se a loja só imprime quando o cliente quer."
              ligado={config.auto_print_sale}
              onChange={(v) => upd("auto_print_sale", v)}
            />
            <Interruptor
              rotulo="Imprimir a ficha sozinha"
              ajuda="Quando a venda deixa item para retirar depois, a ficha sai junto. É o papel que o cliente apresenta na volta."
              ligado={config.auto_print_credit}
              onChange={(v) => upd("auto_print_credit", v)}
            />
            {config.auto_print_credit && (
              <div className="space-y-1.5 pl-3">
                <Label htmlFor="impViasFicha">Vias da ficha</Label>
                <Input
                  id="impViasFicha"
                  type="number"
                  min="1"
                  max="3"
                  value={config.credit_copies}
                  onChange={(e) => upd("credit_copies", parseInt(e.target.value, 10) || 1)}
                  disabled={!podeConfigurar}
                  className="campo num h-11 w-24 rounded-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Uma para o cliente. Duas se a loja quiser guardar a segunda no balcão.
                </p>
              </div>
            )}
            <Interruptor
              rotulo="Cortar o papel"
              ajuda="Corte parcial ao fim do cupom. Desligue se a impressora não tiver guilhotina."
              ligado={config.cut_paper}
              onChange={(v) => upd("cut_paper", v)}
            />
            <Interruptor
              rotulo="Abrir a gaveta de dinheiro"
              ajuda="Pulso pelo cabo da impressora, só em venda que recebeu dinheiro. Em venda no cartão a gaveta fica fechada."
              ligado={config.open_drawer}
              onChange={(v) => upd("open_drawer", v)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="impCodepage">Tabela de acentos</Label>
              <Ajuda>
                Só mexa se os acentos saírem errados na página de teste. 16 (WPC1252) funciona na
                maioria das térmicas vendidas no Brasil.
              </Ajuda>
            </div>
            <Input
              id="impCodepage"
              type="number"
              min="0"
              max="255"
              value={config.codepage}
              onChange={(e) => upd("codepage", parseInt(e.target.value, 10) || 0)}
              disabled={!podeConfigurar}
              className="campo num h-11 w-24 rounded-sm"
            />
          </div>
        </div>

        {podeConfigurar && (
          <Button
            variant="ghost"
            className="acao-receber mt-5 h-12 w-full rounded-sm font-bold uppercase"
            disabled={salvando}
            onClick={salvar}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        )}
      </section>
    </div>
  );
}

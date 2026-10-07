import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Database,
  Download,
  Eraser,
  FileDown,
  FileUp,
  FolderOutput,
  HardDrive,
  Layers,
  RotateCcw,
  ShieldCheck,
  Store,
  Trash2,
  Usb,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Rotulo } from "@/components/placa";
import { Ajuda } from "@/components/ajuda";
import {
  desktop,
  desktopToken,
  type BackupFile,
  type DataArea,
  type SetupStatus,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

/**
 * Dados do sistema: backup, restauração e modelo de loja.
 *
 * Mora aqui e não na tela de Usuários porque não é assunto de conta: o backup é
 * do banco inteiro — vendas, estoque, turnos, fornecedores, configurações. Ele
 * só estava lá porque não havia rota própria, e isso fazia parecer que a cópia
 * era só das contas.
 */

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtTamanho = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const ROTULO_AREA: Record<DataArea, string> = {
  vendas: "Vendas",
  estoque: "Estoque",
  sistema: "Sistema",
};

/** O nome do arquivo diz por que a cópia foi feita. */
function origemDe(nome: string): { rotulo: string; cor?: string } {
  if (nome.includes("pre-restauracao")) {
    return { rotulo: "Salvaguarda antes de restaurar", cor: "var(--warning)" };
  }
  if (nome.includes("pre-limpeza")) {
    return { rotulo: "Salvaguarda antes de limpar dados", cor: "var(--warning)" };
  }
  if (nome.includes("manual")) return { rotulo: "Manual" };
  return { rotulo: "Automático" };
}

/** Pasta onde a cópia está, para quem vai copiar para o pendrive. */
const pastaDe = (caminho: string) => caminho.slice(0, caminho.lastIndexOf("/")) || caminho;

export function ConfigDados({ podeGerir }: { podeGerir: boolean }) {
  const { role } = useAuth();
  const [copias, setCopias] = useState<BackupFile[]>([]);
  const [alvo, setAlvo] = useState<BackupFile | null>(null);
  const [instalacao, setInstalacao] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * O que levar para a outra loja. Nem toda loja irmã quer o mesmo: às vezes
   * só o catálogo, às vezes só os perfis. Exportar tudo obrigava a apagar à
   * mão o que não devia viajar.
   */
  const [selecao, setSelecao] = useState({
    produtos: true,
    cupom: true,
    papeis: true,
    usuarios: true,
  });

  /*
   * Dados por área. Pedido do cliente: vendas numa pasta, estoque noutra,
   * apagar anos antigos de venda sem perder o estoque, e escolher o que exportar.
   */
  const [areas, setAreas] = useState<Record<DataArea, boolean>>({
    vendas: true,
    estoque: true,
    sistema: false,
  });
  const [importacao, setImportacao] = useState<{ origem: string; area: DataArea } | null>(null);
  const [limpezaArea, setLimpezaArea] = useState<DataArea>("vendas");
  const [limpezaData, setLimpezaData] = useState("");
  const [limpezaConfirma, setLimpezaConfirma] = useState(false);
  const [limpezaTexto, setLimpezaTexto] = useState("");
  const [apagarCopia, setApagarCopia] = useState<BackupFile | null>(null);

  const carregar = useCallback(async () => {
    const token = desktopToken();
    if (!token) return;
    try {
      const [lista, status] = await Promise.all([
        desktop.listBackups(token),
        desktop.setupStatus().catch(() => null),
      ]);
      setCopias(lista);
      setInstalacao(status);
    } catch {
      setCopias([]);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const copiarAgora = async () => {
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    setBusy(true);
    try {
      const criado = await desktop.createBackup(token);
      toast.success(`Cópia criada · ${fmtTamanho(criado.size_bytes)}`);
      await carregar();
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível criar a cópia");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cópia para onde o usuário escolher — pendrive, HD externo, pasta na rede.
   *
   * O backup automático fica na mesma máquina: num roubo ou num disco
   * queimado, ele vai junto. Este botão é o que protege de verdade.
   */
  const salvarCopiaExterna = async () => {
    const token = desktopToken();
    if (!token) return;
    const agora = new Date();
    const carimbo = `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, "0")}${String(agora.getDate()).padStart(2, "0")}`;
    const destino = await save({
      title: "Salvar cópia do sistema",
      defaultPath: `k7-backup-${carimbo}.sqlite3`,
      filters: [{ name: "Banco do K7Cabines", extensions: ["sqlite3"] }],
    });
    if (!destino) return;

    setBusy(true);
    try {
      const arquivo = await desktop.exportBackup(token, destino);
      toast.success(`Cópia salva em ${arquivo.path} · ${fmtTamanho(arquivo.size_bytes)}`);
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível salvar a cópia");
    } finally {
      setBusy(false);
    }
  };

  const restaurar = async () => {
    if (!alvo) return;
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    setBusy(true);
    try {
      await desktop.restoreBackup(token, alvo.path);
      toast.success("Banco restaurado. Recarregando o sistema…");
      setAlvo(null);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível restaurar");
      setBusy(false);
    }
  };

  /**
   * Exportar é escolher onde salvar, no seletor do sistema — inclusive num
   * pendrive. Digitar o caminho de cabeça só funcionava para quem sabe onde
   * fica a pasta pessoal, e errar um caractere gerava erro sem explicação.
   */
  const exportarModelo = async () => {
    const token = desktopToken();
    if (!token) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const destino = await save({
      title: "Salvar modelo de loja",
      defaultPath: `modelo-k7-${hoje}.toml`,
      filters: [{ name: "Modelo de loja", extensions: ["toml"] }],
    });
    if (!destino) return;

    setBusy(true);
    try {
      const caminho = await desktop.exportTemplateSelection(token, destino, selecao);
      toast.success(`Modelo salvo em ${caminho}`);
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível exportar o modelo");
    } finally {
      setBusy(false);
    }
  };

  const importarModelo = async () => {
    const token = desktopToken();
    if (!token) return;
    const origem = await open({
      title: "Escolher modelo de loja",
      multiple: false,
      directory: false,
      // Modelos exportados antes da mudança de formato ainda são JSON.
      filters: [{ name: "Modelo de loja", extensions: ["toml", "json"] }],
    });
    if (typeof origem !== "string") return;

    setBusy(true);
    try {
      const r = await desktop.importTemplate(token, origem);
      toast.success(
        `Modelo importado: ${r.produtos_criados} produto(s) criado(s), ${r.produtos_atualizados} atualizado(s).`,
      );
      await carregar();
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível importar o modelo");
    } finally {
      setBusy(false);
    }
  };

  const exportarAreas = async () => {
    const token = desktopToken();
    if (!token) return;
    const escolhidas = (Object.keys(areas) as DataArea[]).filter((a) => areas[a]);
    if (!escolhidas.length) return toast.error("Marque pelo menos uma área");
    const pastaDestino = await open({
      title: "Escolher a pasta para os arquivos",
      directory: true,
      multiple: false,
    });
    if (typeof pastaDestino !== "string") return;
    setBusy(true);
    try {
      for (const area of escolhidas) {
        const arquivo = await desktop.exportDataArea(token, area, pastaDestino);
        toast.success(`${ROTULO_AREA[area]}: ${arquivo.file_name} · ${arquivo.linhas} linha(s)`);
      }
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível exportar");
    } finally {
      setBusy(false);
    }
  };

  const escolherArquivoDeArea = async () => {
    const token = desktopToken();
    if (!token) return;
    const origem = await open({
      title: "Escolher arquivo exportado",
      multiple: false,
      directory: false,
      filters: [{ name: "Exportação do K7", extensions: ["json"] }],
    });
    if (typeof origem !== "string") return;
    try {
      const area = await desktop.inspectDataFile(token, origem);
      setImportacao({ origem, area });
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Arquivo inválido");
    }
  };

  const importarArea = async () => {
    const token = desktopToken();
    if (!token || !importacao) return;
    setBusy(true);
    try {
      const r = await desktop.importDataArea(token, importacao.origem);
      toast.success(`${ROTULO_AREA[r.area]} importado: ${r.linhas} linha(s) em ${r.tabelas} tabela(s).`);
      setImportacao(null);
      await carregar();
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível importar");
    } finally {
      setBusy(false);
    }
  };

  const limpar = async () => {
    const token = desktopToken();
    if (!token) return;
    setBusy(true);
    try {
      const r = await desktop.purgeDataArea(token, limpezaArea, limpezaData);
      toast.success(
        `${ROTULO_AREA[r.area]}: ${r.apagadas} registro(s) apagado(s) antes de ${r.antes_de.split("-").reverse().join("/")}. Backup prévio: ${r.backup.file_name}`,
      );
      setLimpezaConfirma(false);
      setLimpezaTexto("");
      await carregar();
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível limpar");
    } finally {
      setBusy(false);
    }
  };

  const confirmarApagarCopia = async () => {
    const token = desktopToken();
    if (!token || !apagarCopia) return;
    setBusy(true);
    try {
      await desktop.deleteBackup(token, apagarCopia.path);
      toast.success("Cópia apagada");
      setApagarCopia(null);
      await carregar();
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não foi possível apagar a cópia");
    } finally {
      setBusy(false);
    }
  };

  const pasta = copias[0] ? pastaDe(copias[0].path) : null;
  // Só o caminho não diz nada a quem nunca viu AppData; o nome ajuda a achar.
  const nomeDoLocal = pasta?.includes("AppData")
    ? "Pasta de dados do aplicativo, no perfil do usuário do Windows"
    : pasta?.includes("Library")
      ? "Biblioteca de suporte do aplicativo, no seu usuário do macOS"
      : "Pasta de dados do aplicativo";

  return (
    <div className="max-w-5xl space-y-4">
      <section className="placa p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg">
              <Database className="h-4 w-4" aria-hidden /> Backup do sistema
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              A cópia é do banco inteiro: vendas, turnos, estoque, lotes, fornecedores, contas e
              configurações. É feita automaticamente uma vez por dia ao abrir o aplicativo.
              O parâmetro <strong>Backups mantidos</strong> apaga só as <strong>cópias</strong>{" "}
              mais antigas da lista abaixo — nunca apaga vendas, estoque ou qualquer dado do
              sistema. Para apagar dados, use <strong>Limpar dados antigos</strong> mais abaixo.
            </p>
          </div>
          {podeGerir && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                onClick={salvarCopiaExterna}
                disabled={busy}
                variant="outline"
                className="campo h-11 rounded-sm px-4"
              >
                <Usb className="mr-2 h-4 w-4" aria-hidden /> Salvar cópia em…
              </Button>
              <Button
                onClick={copiarAgora}
                disabled={busy}
                variant="ghost"
                className="acao-receber h-11 rounded-sm px-4 font-bold uppercase"
                style={{ fontFamily: "var(--font-display)" }}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden /> Copiar agora
              </Button>
            </div>
          )}
        </div>

        {pasta && (
          <div className="mb-3 flex items-start gap-2 border border-border p-3">
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <Rotulo className="block">Onde as cópias ficam</Rotulo>
              <p className="text-xs text-muted-foreground">{nomeDoLocal}</p>
              <p className="num mt-0.5 break-all text-xs text-muted-foreground">{pasta}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                O backup fica <strong>na mesma máquina</strong>. Se o computador queimar ou for
                roubado, ele vai junto — use <strong>Salvar cópia em…</strong> para gravar num
                pendrive de tempos em tempos.
              </p>
            </div>
          </div>
        )}

        {copias.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma cópia ainda. A primeira é criada automaticamente ao abrir o sistema.
          </p>
        ) : (
          <div className="painel max-h-72 divide-y divide-border overflow-y-auto">
            {copias.map((f) => {
              const origem = origemDe(f.file_name);
              return (
                <div key={f.path} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="num truncate text-sm">{fmtData(f.created_at)}</div>
                    <div className="rotulo num text-[10px]" style={{ color: origem.cor }}>
                      {origem.rotulo} · {fmtTamanho(f.size_bytes)}
                    </div>
                  </div>
                  {podeGerir && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        className="campo h-11 rounded-sm px-3 text-xs"
                        onClick={() => setAlvo(f)}
                        disabled={busy}
                      >
                        <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden /> Restaurar
                      </Button>
                      <Button
                        variant="ghost"
                        className="acao-destrutiva h-11 w-11 rounded-sm p-0"
                        onClick={() => setApagarCopia(f)}
                        disabled={busy}
                        title="Apagar esta cópia"
                        aria-label="Apagar esta cópia"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="placa p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <Layers className="h-4 w-4" aria-hidden /> Exportar e importar por área
          <Ajuda>
            Cada área sai num arquivo próprio: dá para guardar as vendas numa pasta e o estoque
            noutra, ou levar só o estoque para outro computador sem carregar o histórico de vendas.
          </Ajuda>
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Escolha o que exportar. Cada área vira um arquivo <span className="num">.json</span>{" "}
          separado na pasta que você escolher.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(
            [
              ["vendas", "Vendas", "Vendas, itens, devoluções, exclusões, turnos e fichas."],
              ["estoque", "Estoque", "Produtos, saldos, lotes, categorias, fornecedores e movimentações."],
              ["sistema", "Sistema", "Contas, perfis, permissões, cupom, parâmetros e auditoria."],
            ] as const
          ).map(([chave, rotulo, ajuda]) => (
            <label
              key={chave}
              className="flex cursor-pointer items-start gap-2.5 border border-border p-2.5"
            >
              <input
                type="checkbox"
                className="marcador mt-0.5 shrink-0"
                checked={areas[chave]}
                onChange={(e) => setAreas({ ...areas, [chave]: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block text-sm">{rotulo}</span>
                <span className="block text-xs text-muted-foreground">{ajuda}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="campo h-11 rounded-sm px-4"
            disabled={busy || !podeGerir || !Object.values(areas).some(Boolean)}
            onClick={exportarAreas}
          >
            <FolderOutput className="mr-2 h-4 w-4" aria-hidden /> Exportar para pasta…
          </Button>
          <Button
            variant="outline"
            className="campo h-11 rounded-sm px-4"
            disabled={busy || !podeGerir}
            onClick={escolherArquivoDeArea}
          >
            <FileUp className="mr-2 h-4 w-4" aria-hidden /> Importar arquivo de área…
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Na importação, registro com a mesma chave é substituído e o que falta é criado. Contas
          que já existem aqui ficam como estão. Importar é só para a conta master.
        </p>
      </section>

      <section className="placa p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <Eraser className="h-4 w-4" aria-hidden /> Limpar dados antigos
          <Ajuda>
            Libera espaço apagando o histórico anterior a uma data. Produtos, saldos, contas e
            configurações não são tocados. Antes de apagar, o sistema grava um backup.
          </Ajuda>
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Exporte a área antes, se quiser guardar o histórico. Só a conta master pode limpar.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="limpezaArea">Área</Label>
            <select
              id="limpezaArea"
              className="campo h-11 rounded-sm px-3 text-sm"
              value={limpezaArea}
              onChange={(e) => setLimpezaArea(e.target.value as DataArea)}
            >
              <option value="vendas">Vendas (vendas, turnos, fichas encerradas)</option>
              <option value="estoque">Estoque (movimentações e inventários; saldos ficam)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="limpezaData">Apagar tudo anterior a</Label>
            <Input
              id="limpezaData"
              type="date"
              className="campo h-11 rounded-sm"
              value={limpezaData}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setLimpezaData(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            className="acao-destrutiva h-11 rounded-sm px-5 font-bold uppercase"
            style={{ fontFamily: "var(--font-display)" }}
            disabled={busy || !podeGerir || !limpezaData}
            onClick={() => setLimpezaConfirma(true)}
          >
            <Eraser className="mr-2 h-4 w-4" aria-hidden /> Limpar…
          </Button>
        </div>
      </section>

      <section className="placa p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <Store className="h-4 w-4" aria-hidden /> Modelo de loja
          <Ajuda>
            Diferente do backup: o modelo é o que as lojas têm em comum, feito para ser levado
            para outra instalação. O backup é esta loja inteira, feito para voltar aqui.
          </Ajuda>
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Leva catálogo, categorias, cupom, perfis e contas para outra loja.{" "}
          <strong>Vendas, turnos, estoque e lotes nunca viajam</strong> — cada instalação continua
          independente.
        </p>

        <div className="mt-4 space-y-2">
          <Rotulo>O que levar</Rotulo>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["produtos", "Catálogo e categorias", "Produtos, preços, unidade, \"piscar na venda\" e a árvore de categorias com cor e ordem."],
                ["cupom", "Layout do cupom", "Rótulos e o que aparece impresso. Nome e endereço da loja nunca viajam."],
                ["papeis", "Perfis de acesso", "Os perfis e as permissões de cada um."],
                ["usuarios", "Contas", "As pessoas. Conta já existente na loja destino mantém a senha local."],
              ] as const
            ).map(([chave, rotulo, ajuda]) => (
              <label
                key={chave}
                className="flex cursor-pointer items-start gap-2.5 border border-border p-2.5"
              >
                <input
                  type="checkbox"
                  className="marcador mt-0.5 shrink-0"
                  checked={selecao[chave]}
                  onChange={(e) => setSelecao({ ...selecao, [chave]: e.target.checked })}
                />
                <span className="min-w-0">
                  <span className="block text-sm">{rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{ajuda}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="campo h-11 rounded-sm px-4"
            disabled={busy || !podeGerir || !Object.values(selecao).some(Boolean)}
            onClick={exportarModelo}
          >
            <FileDown className="mr-2 h-4 w-4" aria-hidden /> Exportar modelo…
          </Button>
          <Button
            variant="outline"
            className="campo h-11 rounded-sm px-4"
            disabled={busy || !podeGerir}
            onClick={importarModelo}
          >
            <FileUp className="mr-2 h-4 w-4" aria-hidden /> Importar modelo…
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          O arquivo é um <span className="num">.toml</span> comentado: dá para abrir num editor de
          texto, conferir e até ajustar antes de importar na outra loja.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Na importação, produto com o mesmo código é atualizado e o que falta é criado com estoque
          zero. Contas que já existem aqui mantêm a senha local, e a conta master nunca viaja.
        </p>

        {instalacao?.installation_id && role === "master" && (
          <div className="mt-4 border-t border-border pt-3">
            <Rotulo>Configuração inicial</Rotulo>
            <p className="mt-1 text-xs text-muted-foreground">
              O roteiro guiado de loja, cupom, impressora, parâmetros e catálogo. Reabrir não apaga
              nada: só mostra as etapas de novo na próxima tela.
            </p>
            <Button
              variant="outline"
              className="campo mt-2 h-11 rounded-sm px-4"
              disabled={busy}
              onClick={async () => {
                const token = desktopToken();
                if (!token) return;
                try {
                  await desktop.setOnboarding(token, false);
                  try {
                    sessionStorage.removeItem("k7:assistente-adiado");
                  } catch {
                    /* sem sessionStorage */
                  }
                  window.location.reload();
                } catch (erro) {
                  toast.error(typeof erro === "string" ? erro : "Não foi possível reabrir");
                }
              }}
            >
              Reabrir configuração inicial
            </Button>
          </div>
        )}

        {instalacao?.installation_id && (
          <div className="mt-4 border-t border-border pt-3">
            <Rotulo>Identificador desta instalação</Rotulo>
            <p className="num mt-1 break-all text-xs text-muted-foreground">
              {instalacao.installation_id}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Anote junto com o nome da loja: é o que distingue os backups de lojas diferentes na
              hora de restaurar o arquivo certo.
            </p>
          </div>
        )}
      </section>

      <Dialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Restaurar esta cópia?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Todo o banco volta ao estado de{" "}
                  <strong className="num">{alvo && fmtData(alvo.created_at)}</strong>. Vendas,
                  movimentos de estoque, turnos e contas criados depois dessa data{" "}
                  <strong>serão perdidos</strong>.
                </p>
                <p
                  className="flex items-start gap-2 border p-3"
                  style={{
                    borderColor: "var(--success)",
                    background: "color-mix(in oklab, var(--success) 12%, transparent)",
                  }}
                >
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Antes de substituir, o sistema confere a integridade do arquivo e grava uma
                    cópia do estado atual — esta operação também pode ser desfeita.
                  </span>
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11 rounded-sm px-5"
              onClick={() => setAlvo(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className={cn("acao-destrutiva h-11 rounded-sm px-6 font-bold uppercase")}
              onClick={restaurar}
              disabled={busy}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Restaurando…" : "Restaurar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!apagarCopia} onOpenChange={(o) => !o && setApagarCopia(null)}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Apagar esta cópia?</DialogTitle>
            <DialogDescription>
              A cópia de <strong className="num">{apagarCopia && fmtData(apagarCopia.created_at)}</strong>{" "}
              será removida do disco. Não dá para desfazer. O banco em uso não muda.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11 rounded-sm px-5" onClick={() => setApagarCopia(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-destrutiva h-11 rounded-sm px-6 font-bold uppercase"
              onClick={confirmarApagarCopia}
              disabled={busy}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Apagar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!importacao} onOpenChange={(o) => !o && setImportacao(null)}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              Importar {importacao && ROTULO_AREA[importacao.area].toLowerCase()}?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="num break-all text-xs text-muted-foreground">{importacao?.origem}</p>
                <p>
                  Registros do arquivo com a mesma chave <strong>substituem</strong> os daqui; o que
                  falta é criado. Contas existentes ficam como estão.
                </p>
                <p>
                  Se o arquivo depender de outra área (vendas precisam dos produtos), importe
                  aquela primeiro. Em caso de conflito, nada é gravado.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11 rounded-sm px-5" onClick={() => setImportacao(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
              onClick={importarArea}
              disabled={busy}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Importando…" : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={limpezaConfirma}
        onOpenChange={(o) => {
          if (!o) {
            setLimpezaConfirma(false);
            setLimpezaTexto("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">Apagar {ROTULO_AREA[limpezaArea].toLowerCase()} antigas?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Todo o histórico de <strong>{ROTULO_AREA[limpezaArea].toLowerCase()}</strong>{" "}
                  anterior a{" "}
                  <strong className="num">{limpezaData.split("-").reverse().join("/")}</strong>{" "}
                  será apagado do banco e o espaço devolvido ao disco.
                </p>
                <p
                  className="flex items-start gap-2 border p-3"
                  style={{
                    borderColor: "var(--success)",
                    background: "color-mix(in oklab, var(--success) 12%, transparent)",
                  }}
                >
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Antes de apagar, o sistema grava uma cópia <strong>pre-limpeza</strong> na lista
                    de backups. Se precisar voltar atrás, restaure essa cópia.
                  </span>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="limpezaTexto">Digite APAGAR para confirmar</Label>
                  <Input
                    id="limpezaTexto"
                    className="campo h-11 rounded-sm"
                    value={limpezaTexto}
                    onChange={(e) => setLimpezaTexto(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11 rounded-sm px-5"
              onClick={() => {
                setLimpezaConfirma(false);
                setLimpezaTexto("");
              }}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="ghost"
              className={cn("acao-destrutiva h-11 rounded-sm px-6 font-bold uppercase")}
              onClick={limpar}
              disabled={busy || limpezaTexto.trim().toUpperCase() !== "APAGAR"}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {busy ? "Apagando…" : "Apagar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

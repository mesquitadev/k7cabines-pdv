import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isDesktop } from "@/lib/desktop";

/**
 * Atualização do aplicativo.
 *
 * Ao entrar, o app consulta uma vez, em silêncio, se há versão nova publicada.
 * Sem internet nada acontece — ausência de rede não é erro neste sistema, e a
 * loja continua vendendo. Quando há versão nova, aparece um aviso com a opção
 * de baixar e instalar agora ou deixar para depois; "depois" vale até o app ser
 * aberto de novo.
 *
 * O pacote baixado é conferido contra a chave pública gravada no app: um
 * arquivo que não foi assinado com a nossa chave privada é recusado.
 */

/** Adiado nesta sessão: não insistir até reabrir o aplicativo. */
const CHAVE_ADIADA = "k7:atualizacao-adiada";

export function Atualizacao() {
  const [atualizacao, setAtualizacao] = useState<Update | null>(null);
  const [etapa, setEtapa] = useState<"aviso" | "baixando" | "pronto">("aviso");
  const [baixado, setBaixado] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    try {
      if (sessionStorage.getItem(CHAVE_ADIADA)) return;
    } catch {
      /* sem sessionStorage: consulta mesmo assim */
    }
    let ativo = true;
    // Consulta única, com tolerância: sem rede, servidor fora ou arquivo
    // inválido, o app segue como se nada houvesse.
    check({ timeout: 8000 })
      .then((u) => {
        if (ativo && u) setAtualizacao(u);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  if (!atualizacao) return null;

  const adiar = () => {
    try {
      sessionStorage.setItem(CHAVE_ADIADA, "1");
    } catch {
      /* vale só até fechar */
    }
    setAtualizacao(null);
  };

  const instalar = async () => {
    setEtapa("baixando");
    setErro(null);
    try {
      await atualizacao.downloadAndInstall((evento) => {
        if (evento.event === "Started") setTotal(evento.data.contentLength ?? null);
        if (evento.event === "Progress") setBaixado((b) => b + evento.data.chunkLength);
        if (evento.event === "Finished") setEtapa("pronto");
      });
      setEtapa("pronto");
      await relaunch();
    } catch (e) {
      setEtapa("aviso");
      setErro(
        typeof e === "string"
          ? e
          : "Não foi possível baixar a atualização. Tente de novo mais tarde ou instale pelo arquivo.",
      );
    }
  };

  const pct = total ? Math.min(100, Math.round((baixado / total) * 100)) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && etapa === "aviso" && adiar()}>
      <DialogContent className="max-w-lg rounded-sm">
        <DialogHeader>
          <DialogTitle className="text-2xl">Atualização disponível</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Versão <strong className="num">{atualizacao.version}</strong> pronta para instalar
                {atualizacao.currentVersion && (
                  <>
                    {" "}
                    (esta é a <span className="num">{atualizacao.currentVersion}</span>)
                  </>
                )}
                .
              </p>
              {atualizacao.body && (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-sm bg-secondary p-3 text-xs">
                  {atualizacao.body}
                </pre>
              )}
              <p className="text-xs text-muted-foreground">
                O aplicativo fecha e reabre sozinho ao terminar. Vendas e configurações continuam
                como estão. Faça isso com o turno fechado, de preferência.
              </p>
              {etapa === "baixando" && (
                <div>
                  <div className="h-2 w-full overflow-hidden rounded-sm bg-secondary">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${pct ?? 30}%` }}
                    />
                  </div>
                  <p className="num mt-1 text-xs text-muted-foreground">
                    {pct !== null ? `${pct}%` : "Baixando…"}
                  </p>
                </div>
              )}
              {etapa === "pronto" && <p className="text-xs">Instalando e reiniciando…</p>}
              {erro && <p className="text-xs text-destructive">{erro}</p>}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            className="h-11 rounded-sm px-5"
            onClick={adiar}
            disabled={etapa !== "aviso"}
          >
            Depois
          </Button>
          <Button
            variant="ghost"
            className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
            style={{ fontFamily: "var(--font-display)" }}
            onClick={instalar}
            disabled={etapa !== "aviso"}
          >
            {etapa === "baixando" ? (
              <>
                <Download className="mr-2 h-4 w-4 animate-pulse" aria-hidden /> Baixando…
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" aria-hidden /> Atualizar agora
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

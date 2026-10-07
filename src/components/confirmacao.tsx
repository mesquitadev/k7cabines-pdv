import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Confirmação de ação, no lugar do `window.confirm`.
 *
 * O `confirm` nativo não retorna dentro do WebView do Tauri: a função que o
 * chama simplesmente sai, sem executar e sem erro — foi o que fez "excluir
 * lote" não fazer nada. Além disso ele trava o loop de eventos e ignora o tema
 * do aplicativo.
 *
 * Uso:
 *
 * ```tsx
 * const confirmar = useConfirmacao();
 * if (!(await confirmar({ titulo: "Excluir?", acao: "Excluir" }))) return;
 * ```
 */

type Pedido = {
  titulo: string;
  descricao?: ReactNode;
  /** Texto do botão que confirma. Diga o que vai acontecer, não "OK". */
  acao?: string;
  cancelar?: string;
  destrutivo?: boolean;
};

type Confirmar = (pedido: Pedido) => Promise<boolean>;

const Contexto = createContext<Confirmar | null>(null);

export function ProvedorConfirmacao({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmar = useCallback<Confirmar>((novo) => {
    setPedido(novo);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const responder = (ok: boolean) => {
    setPedido(null);
    // Fechar sem responder deixaria a promessa pendente para sempre, e o
    // chamador travado num `await` que nunca volta.
    resolver.current?.(ok);
    resolver.current = null;
  };

  const valor = useMemo(() => confirmar, [confirmar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <AlertDialog open={!!pedido} onOpenChange={(aberto) => !aberto && responder(false)}>
        <AlertDialogContent className="rounded-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">{pedido?.titulo}</AlertDialogTitle>
            {pedido?.descricao && (
              <AlertDialogDescription asChild>
                <div className="text-sm text-muted-foreground">{pedido.descricao}</div>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-sm" onClick={() => responder(false)}>
              {pedido?.cancelar ?? "Cancelar"}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "h-11 rounded-sm font-bold uppercase",
                pedido?.destrutivo ? "acao-destrutiva" : "acao-receber",
              )}
              style={{ fontFamily: "var(--font-display)" }}
              onClick={() => responder(true)}
            >
              {pedido?.acao ?? "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Contexto.Provider>
  );
}

export function useConfirmacao(): Confirmar {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useConfirmacao precisa estar dentro de ProvedorConfirmacao");
  }
  return contexto;
}

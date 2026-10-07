import { useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
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
 * Painel lateral: o frame de todo formulário longo do sistema.
 *
 * Um modal centralizado com dez campos vira uma caixa que ocupa a tela inteira
 * e ainda rola por dentro — a pior das duas formas. O painel encosta na
 * direita, usa a altura toda, mantém cabeçalho e rodapé fixos e deixa só o
 * miolo rolar. A lista atrás continua visível, o que importa quando se cadastra
 * um item olhando para os outros.
 */
export function PainelLateral({
  aberto,
  onAbertoMudou,
  icone: Icone,
  titulo,
  descricao,
  selo,
  children,
  rodape,
  largura = "sm:max-w-2xl",
  confirmarDescarte = false,
}: {
  aberto: boolean;
  onAbertoMudou: (aberto: boolean) => void;
  icone?: LucideIcon;
  titulo: string;
  descricao?: ReactNode;
  selo?: string;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: string;
  /**
   * Quando há dado digitado, fechar por Esc, clique fora ou X pede confirmação.
   * Fechamento programático (depois de salvar) não passa por aqui.
   */
  confirmarDescarte?: boolean;
}) {
  const [perguntaDescarte, setPerguntaDescarte] = useState(false);

  const aoMudar = (proximo: boolean) => {
    if (!proximo && confirmarDescarte) {
      setPerguntaDescarte(true);
      return;
    }
    onAbertoMudou(proximo);
  };

  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-border bg-background shadow-2xl outline-none",
            "transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300",
            largura,
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              {Icone && (
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground"
                >
                  <Icone className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <DialogTitle className="truncate text-xl">{titulo}</DialogTitle>
                  {selo && (
                    <span className="rotulo shrink-0 border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {selo}
                    </span>
                  )}
                </div>
                {descricao && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{descricao}</p>
                )}
              </div>
            </div>

            <DialogClose
              aria-label="Fechar"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogClose>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">{children}</div>

          {rodape && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
              {rodape}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>

      <AlertDialog open={perguntaDescarte} onOpenChange={setPerguntaDescarte}>
        <AlertDialogContent className="rounded-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              Há dados preenchidos que ainda não foram salvos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-sm">Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="acao-destrutiva h-11 rounded-sm"
              onClick={() => {
                setPerguntaDescarte(false);
                onAbertoMudou(false);
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/** Seção do formulário, com micro-título e marcador. */
export function SecaoForm({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <h4 className="rotulo flex items-center gap-2 text-[11px] text-muted-foreground">
        <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-primary" />
        {titulo}
      </h4>
      {children}
    </section>
  );
}

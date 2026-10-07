import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CircleCheck, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  corDaLinha,
  estiloValidade,
  linhaDe,
  nomeDaLinha,
  type Linha,
  type Validade,
} from "@/lib/placa";

/**
 * Interação assinatura: a placa vira.
 * Só os dígitos que realmente mudaram assentam, escalonados da direita para a
 * esquerda, como um painel split-flap. Nada mais na tela se move.
 */
export function Numeros({
  valor,
  className,
  animar = true,
}: {
  valor: string;
  className?: string;
  animar?: boolean;
}) {
  const anterior = useRef(valor);
  const [chaves, setChaves] = useState<number[]>(() => valor.split("").map(() => 0));

  useEffect(() => {
    if (anterior.current === valor) return;
    const antes = anterior.current;
    setChaves((atuais) =>
      valor.split("").map((ch, i) => {
        const mesmo = antes[antes.length - valor.length + i] === ch;
        return mesmo ? (atuais[i] ?? 0) : (atuais[i] ?? 0) + 1;
      }),
    );
    anterior.current = valor;
  }, [valor]);

  if (!animar) {
    return <span className={cn("num", className)}>{valor}</span>;
  }

  const total = valor.length;
  return (
    <span className={cn("num", className)}>
      {valor.split("").map((ch, i) => (
        <span
          key={`${i}-${chaves[i] ?? 0}`}
          className="digito"
          style={{ animationDelay: `${(total - 1 - i) * 22}ms` }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

/** Etiqueta de wayfinding: pequena, condensada, espaçada. */
export function Rotulo({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("rotulo text-[11px] text-muted-foreground", className)} {...props}>
      {children}
    </span>
  );
}

/** Faixa sólida na cor da linha da categoria. */
export function FaixaLinha({ categoria, className }: { categoria: string; className?: string }) {
  const linha = linhaDe(categoria);
  return (
    <div
      className={cn("faixa-linha", className)}
      style={{ ["--linha" as string]: corDaLinha[linha] }}
      aria-hidden
    />
  );
}

/** Selo de categoria: cor da linha + nome, porque cor sozinha não informa. */
export function SeloLinha({ categoria, className }: { categoria: string; className?: string }) {
  const linha: Linha = linhaDe(categoria);
  return (
    <span
      className={cn(
        "rotulo inline-flex max-w-full items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[10px]",
        className,
      )}
      style={{
        color: corDaLinha[linha],
        background: `color-mix(in oklab, ${corDaLinha[linha]} 16%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0"
        style={{ background: corDaLinha[linha] }}
      />
      <span className="truncate">{nomeDaLinha[linha]}</span>
    </span>
  );
}

/**
 * Status de serviço da validade. O rótulo sempre acompanha a cor, e a forma do
 * marcador difere por status, para que nada dependa só de cor.
 */
export function StatusValidade({
  validade,
  className,
  compacto = false,
}: {
  validade: Validade;
  className?: string;
  compacto?: boolean;
}) {
  const estilo = estiloValidade[validade.status];
  if (validade.status === "sem-controle") {
    return (
      <span className={cn("rotulo text-[10px] text-muted-foreground", className)}>
        {compacto ? "—" : validade.rotulo}
      </span>
    );
  }

  /*
   * Na placa do catálogo o espaço é curto: o rótulo encolhe para o essencial
   * (dias restantes, ou "vencido"), com o texto completo no title.
   */
  const texto = compacto
    ? validade.status === "vencido"
      ? "Vencido"
      : `${validade.dias}d`
    : validade.rotulo;
  // Ícone desenhado, não glifo Unicode: a forma distingue o status sem depender de cor.
  const Icone =
    validade.status === "vencido" ? AlertTriangle : validade.status === "vencendo" ? Clock3 : CircleCheck;
  return (
    <span
      className={cn("rotulo inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 py-0.5 text-[10px]", className)}
      style={{ color: estilo.cor, background: estilo.fundo }}
      title={validade.data ? `${validade.rotulo} · ${validade.data.split("-").reverse().join("/")}` : validade.rotulo}
    >
      <Icone className="h-3 w-3 shrink-0" aria-hidden />
      {texto}
    </span>
  );
}

/** Placa esmaltada: a unidade física do sistema. */
export function Placa({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("placa", className)} {...props}>
      {children}
    </div>
  );
}

/** Painel de horário: bloco claro impresso, pregado sobre a placa. */
export function Painel({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("painel", className)} {...props}>
      {children}
    </div>
  );
}
